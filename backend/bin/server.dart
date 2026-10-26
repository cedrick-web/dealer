import 'dart:convert';
import 'dart:io';
import 'dart:typed_data' show BytesBuilder;
import 'package:bcrypt/bcrypt.dart';
import 'package:crypto/crypto.dart';
import 'package:mongo_dart/mongo_dart.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as io;
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

final uid = const Uuid();
const maxLoginFailures = 8;
const loginFailureWindow = Duration(minutes: 15);
final Map<String, List<DateTime>> loginFailures = <String, List<DateTime>>{};

List<DateTime> recentLoginFailures(String key) {
  final cutoff = DateTime.now().subtract(loginFailureWindow);
  final recent = (loginFailures[key] ?? <DateTime>[]).where((at) => at.isAfter(cutoff)).toList();
  if (recent.isEmpty) {
    loginFailures.remove(key);
  } else {
    loginFailures[key] = recent;
  }
  return recent;
}
bool loginIsThrottled(String key) => recentLoginFailures(key).length >= maxLoginFailures;
void recordLoginFailure(String key) {
  final recent = recentLoginFailures(key)..add(DateTime.now());
  loginFailures[key] = recent;
  // Bound memory growth when attackers rotate through arbitrary email strings.
  if (loginFailures.length > 10000) {
    final staleKeys = loginFailures.keys.take(1000).toList();
    for (final staleKey in staleKeys) { loginFailures.remove(staleKey); }
  }
}
void clearLoginFailures(String key) => loginFailures.remove(key);
bool passwordMatches(String password, dynamic passwordHash) {
  if (passwordHash is! String || passwordHash.isEmpty) return false;
  try { return BCrypt.checkpw(password, passwordHash); } catch (_) { return false; }
}

bool hasAllowedFileSignature(String mime, List<int> bytes) {
  if (mime == 'application/pdf') {
    return bytes.length >= 4 && bytes[0] == 37 && bytes[1] == 80 && bytes[2] == 68 && bytes[3] == 70;
  }
  if (mime == 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255;
  }
  if (mime == 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < signature.length) return false;
    for (var index = 0; index < signature.length; index++) {
      if (bytes[index] != signature[index]) return false;
    }
    return true;
  }
  if (mime == 'image/webp') {
    return bytes.length >= 12 && bytes[0] == 82 && bytes[1] == 73 && bytes[2] == 70 && bytes[3] == 70 &&
      bytes[8] == 87 && bytes[9] == 69 && bytes[10] == 66 && bytes[11] == 80;
  }
  return false;
}
final secret = Platform.environment['JWT_SECRET'] ?? 'development-only-change-me-before-deploying';
final storageRoot = Platform.environment['DOCUMENT_STORAGE'] ?? '/data/private-documents';
final listingImageRoot = Platform.environment['LISTING_IMAGE_STORAGE'] ?? '/data/listing-images';
final allowedWebOrigins = (Platform.environment['WEB_ORIGINS'] ?? Platform.environment['WEB_ORIGIN'] ?? 'http://localhost:5173,dealer://app').split(',').map((value) => value.trim()).where((value) => value.isNotEmpty).toSet();
const rwandaDistricts = <String>['Gasabo','Kicukiro','Nyarugenge','Bugesera','Rwamagana','Kamonyi','Musanze','Rubavu','Huye','Muhanga','Rulindo','Rusizi','Gicumbi','Burera','Gakenke','Ngororero','Nyabihu','Rutsiro','Karongi','Nyagatare','Nyamasheke','Nyamagabe','Nyaruguru','Gisagara','Nyanza','Ruhango','Kirehe','Ngoma','Kayonza','Gatsibo'];

Response reply(int status, Object body, [Map<String, String>? headers]) => Response(
  status, body: jsonEncode(body),
  headers: {'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...?headers},
);
String clean(dynamic value, [int max = 3000]) {
  if (value is! String) return '';
  final s = value.trim();
  return s.substring(0, s.length > max ? max : s.length);
}
Map<String, dynamic>? asMap(dynamic value) => value is Map ? Map<String, dynamic>.from(value) : null;

Future<Map<String, dynamic>?> currentUser(Request req, DbCollection users) async {
  final claims = userFrom(req);
  if (claims == null) return null;
  final raw = await users.findOne(where.eq('publicId', claims['sub']));
  final person = asMap(raw);
  if (person == null || person['status'] != 'active') return null;
  // Roles, account status and token version come from MongoDB on each protected
  // request, so role changes and password changes invalidate stale sessions.
  final tokenVersion = person['tokenVersion'] is int ? person['tokenVersion'] as int : 0;
  final claimVersion = claims['ver'] is int ? claims['ver'] as int : 0;
  if (tokenVersion != claimVersion) return null;
  return <String, dynamic>{
    ...claims,
    'role': person['role'] as String? ?? 'member',
    'email': person['email'] as String? ?? claims['email'],
  };
}

Future<Map<String, dynamic>?> readJson(Request req, [int maxBytes = 1024 * 1024]) async {
  final declared = int.tryParse(req.headers['content-length'] ?? '');
  if (declared != null && (declared < 0 || declared > maxBytes)) return null;
  final builder = BytesBuilder(copy: false);
  var totalBytes = 0;
  try {
    await for (final chunk in req.read()) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) return null;
      builder.add(chunk);
    }
    final raw = utf8.decode(builder.takeBytes());
    final decoded = jsonDecode(raw);
    return decoded is Map ? Map<String, dynamic>.from(decoded) : null;
  } catch (_) {
    return null;
  }
}
String b64url(String value) => base64Url.encode(utf8.encode(value)).replaceAll('=', '');
String issueToken(Map<String, dynamic> claims) {
  final payload = b64url(jsonEncode(claims));
  final signature = Hmac(sha256, utf8.encode(secret)).convert(utf8.encode(payload)).toString();
  return payload + '.' + signature;
}
Map<String, dynamic>? userFrom(Request req) {
  final header = req.headers['authorization'] ?? '';
  if (!header.startsWith('Bearer ')) return null;
  final parts = header.substring(7).split('.');
  if (parts.length != 2) return null;
  final expected = Hmac(sha256, utf8.encode(secret)).convert(utf8.encode(parts[0])).toString();
  if (parts[1].length != expected.length) return null;
  var mismatch = 0;
  for (var i = 0; i < expected.length; i++) { mismatch |= expected.codeUnitAt(i) ^ parts[1].codeUnitAt(i); }
  if (mismatch != 0) return null;
  try {
    final claims = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[0]))));
    if (claims is! Map<String, dynamic>) return null;
    if ((claims['exp'] is int ? claims['exp'] as int : 0) < DateTime.now().millisecondsSinceEpoch ~/ 1000) return null;
    return claims;
  } catch (_) { return null; }
}
Response unauthenticated() => reply(401, {'error': 'Sign in is required for this action.'});
String now() => DateTime.now().toUtc().toIso8601String();
String prettyStageForNotification(String stage) => stage.replaceAll('_', ' ').split(' ').map((word) => word.isEmpty ? word : word[0].toUpperCase() + word.substring(1)).join(' ');
String? validPurpose(dynamic v) => ['sale', 'rent'].contains(v) ? v as String : null;
String? validType(dynamic v) => ['house', 'apartment', 'land', 'commercial', 'room'].contains(v) ? v as String : null;
Map<String, dynamic> publicDoc(Map<String, dynamic> source, {bool includeReview = false}) {
  final out = Map<String, dynamic>.from(source);
  out.remove('_id'); out.remove('passwordHash'); out.remove('evidenceHash'); out.remove('tokenVersion');
  out.remove('ownerPrivate'); out.remove('filePath');
  if (!includeReview) { out.remove('reviewNote'); out.remove('reviewedBy'); }
  return out;
}

Future<void> main() async {
  final port = int.tryParse(Platform.environment['API_PORT'] ?? '8080') ?? 8080;
  if (secret.length < 32 || secret.startsWith('CHANGE_ME') || secret == 'development-only-change-me-before-deploying') {
    stderr.writeln('JWT_SECRET must be a private random value of at least 32 characters. Configure it before starting the API.');
    exitCode = 1;
    return;
  }
  final uri = Platform.environment['MONGO_URI'];
  if (uri == null || uri.isEmpty) {
    stderr.writeln('MONGO_URI is required. The API will not start without persistent storage.');
    exitCode = 1;
    return;
  }
  final db = await Db.create(uri);
  await db.open();
  final users = db.collection('users');
  final listings = db.collection('listings');
  final audit = db.collection('audit_events');
  final favorites = db.collection('favorites');
  final leads = db.collection('leads');
  final conversations = db.collection('conversations');
  final messages = db.collection('messages');
  final deals = db.collection('deals');
  final documents = db.collection('documents');
  final listingImages = db.collection('listing_images');
  final agentApplications = db.collection('agent_applications');
  final notifications = db.collection('notifications');

  // Explicit indexes make repeated lookups bounded and protect core identity
  // records from duplicate writes under concurrent requests.
  await users.createIndex(keys: {'email': 1}, unique: true, name: 'users_email_unique');
  await users.createIndex(keys: {'publicId': 1}, unique: true, name: 'users_public_id_unique');
  await listings.createIndex(keys: {'publicId': 1}, unique: true, name: 'listings_public_id_unique');
  await listings.createIndex(keys: {'status': 1, 'createdAt': -1}, name: 'listings_status_created');
  await listings.createIndex(keys: {'ownerId': 1, 'createdAt': -1}, name: 'listings_owner_created');
  await favorites.createIndex(keys: {'userId': 1, 'listingId': 1}, unique: true, name: 'favorites_user_listing_unique');
  await leads.createIndex(keys: {'ownerId': 1, 'createdAt': -1}, name: 'leads_owner_created');
  await leads.createIndex(keys: {'requesterId': 1, 'createdAt': -1}, name: 'leads_requester_created');
  await conversations.createIndex(keys: {'participants': 1, 'updatedAt': -1}, name: 'conversations_participant_updated');
  await messages.createIndex(keys: {'conversationId': 1, 'createdAt': 1}, name: 'messages_conversation_created');
  await deals.createIndex(keys: {'participants': 1, 'updatedAt': -1}, name: 'deals_participant_updated');
  await documents.createIndex(keys: {'listingId': 1, 'createdAt': -1}, name: 'documents_listing_created');
  await documents.createIndex(keys: {'publicId': 1}, unique: true, name: 'documents_public_id_unique');
  await listingImages.createIndex(keys: {'publicId': 1}, unique: true, name: 'listing_images_public_id_unique');
  await listingImages.createIndex(keys: {'listingId': 1, 'createdAt': -1}, name: 'listing_images_listing_created');
  await agentApplications.createIndex(keys: {'userId': 1, 'updatedAt': -1}, name: 'agent_applications_user_updated');
  await audit.createIndex(keys: {'evidenceHash': 1}, name: 'audit_evidence_hash');
  await notifications.createIndex(keys: {'userId': 1, 'createdAt': -1}, name: 'notifications_user_created');
  await notifications.createIndex(keys: {'publicId': 1}, unique: true, name: 'notifications_public_id_unique');

  Future<void> notifyUser({
    required String? recipientId,
    required String? actorId,
    required String type,
    required String title,
    required String body,
    required String destination,
    String? subjectId,
  }) async {
    if (recipientId == null || recipientId.isEmpty || recipientId == actorId) return;
    await notifications.insertOne({
      'publicId': uid.v4(),
      'userId': recipientId,
      'actorId': actorId,
      'type': type,
      'title': clean(title, 140),
      'body': clean(body, 1000),
      'destination': destination,
      'subjectId': subjectId,
      'readAt': null,
      'createdAt': now(),
    });
  }

  // Optional first-run admin bootstrap. Never expose an admin role in public registration.
  final adminEmail = (Platform.environment['BOOTSTRAP_ADMIN_EMAIL'] ?? '').trim().toLowerCase();
  final adminPassword = Platform.environment['BOOTSTRAP_ADMIN_PASSWORD'] ?? '';
  if (adminEmail.isNotEmpty && adminPassword.length >= 14 && utf8.encode(adminPassword).length <= 72 && !adminPassword.startsWith('CHANGE_ME') && await users.findOne(where.eq('email', adminEmail)) == null) {
    await users.insertOne({
      'publicId': uid.v4(), 'name': 'Platform administrator', 'email': adminEmail,
      'passwordHash': BCrypt.hashpw(adminPassword, BCrypt.gensalt()), 'role': 'admin', 'tokenVersion': 0,
      'createdAt': now(), 'status': 'active',
    });
    stdout.writeln('Bootstrap administrator created from environment credentials.');
  }

  final r = Router();
  r.get('/health', (Request q) async {
    final ping = await db.pingCommand();
    return reply(200, {'status': 'ok', 'service': 'komisiyoneri-api', 'database': ping.isNotEmpty ? 'connected' : 'unknown', 'time': now()});
  });
  r.get('/api/v1/districts', (Request q) => reply(200, {'data': rwandaDistricts}));
  r.get('/api/v1/agents', (Request q) async {
    final docs = await agentApplications.modernFind(selector: where.eq('status', 'approved'), sort: {'updatedAt': -1}, limit: 100).toList();
    return reply(200, {'data': docs.map((raw) {
      final d = Map<String, dynamic>.from(raw);
      return <String, dynamic>{
        'publicId': d['publicId'], 'name': d['name'], 'bio': d['bio'], 'districts': d['districts'],
        'experienceYears': d['experienceYears'], 'contactPhone': d['showPhone'] == true ? d['phone'] : null,
        'updatedAt': d['updatedAt'],
      };
    }).toList()});
  });

  r.post('/api/v1/auth/register', (Request q) async {
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final name = clean(b['name'], 100);
    final email = clean(b['email'], 160).toLowerCase();
    final password = b['password'] is String ? b['password'] as String : '';
    final phone = clean(b['phone'], 40);
    if (name.length < 2 || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email) || password.length < 10 || utf8.encode(password).length > 72) {
      return reply(422, {'error': 'Enter your name, a valid email, and a password of 10–72 UTF-8 bytes.'});
    }
    if (await users.findOne(where.eq('email', email)) != null) return reply(409, {'error': 'An account with that email already exists.'});
    final person = {
      'publicId': uid.v4(), 'name': name, 'email': email, 'phone': phone,
      'passwordHash': BCrypt.hashpw(password, BCrypt.gensalt()), 'role': 'member', 'tokenVersion': 0,
      'status': 'active', 'createdAt': now(),
    };
    await users.insertOne(person);
    final token = issueToken({'sub': person['publicId'], 'email': email, 'role': 'member', 'ver': 0, 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60 * 60 * 8});
    return reply(201, {'token': token, 'user': publicDoc(person), 'expiresIn': 28800});
  });
  r.post('/api/v1/auth/login', (Request q) async {
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final email = clean(b['email'], 160).toLowerCase();
    final password = b['password'] is String ? b['password'] as String : '';
    final throttleKey = email.isEmpty ? '<empty-email>' : email;
    if (loginIsThrottled(throttleKey)) {
      return reply(429, {'error': 'Too many sign-in attempts. Wait 15 minutes before trying again.'}, {'retry-after': '900'});
    }
    if (utf8.encode(password).length > 72) {
      recordLoginFailure(throttleKey);
      return reply(401, {'error': 'Email or password is incorrect.'});
    }
    final person = asMap(await users.findOne(where.eq('email', email)));
    if (person == null || person['status'] != 'active' || !passwordMatches(password, person['passwordHash'])) {
      recordLoginFailure(throttleKey);
      return reply(401, {'error': 'Email or password is incorrect.'});
    }
    clearLoginFailures(throttleKey);
    final role = person['role'] as String? ?? 'member';
    final version = person['tokenVersion'] is int ? person['tokenVersion'] as int : 0;
    final token = issueToken({'sub': person['publicId'], 'email': email, 'role': role, 'ver': version, 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60 * 60 * 8});
    return reply(200, {'token': token, 'user': publicDoc(person), 'expiresIn': 28800});
  });
  r.get('/api/v1/me/notifications', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final p = q.url.queryParameters;
    final limit = (int.tryParse(p['limit'] ?? '50') ?? 50).clamp(1, 100).toInt();
    final docs = await notifications.modernFind(selector: where.eq('userId', c['sub']), limit: limit, sort: {'createdAt': -1}).toList();
    final unread = await notifications.modernFind(selector: where.eq('userId', c['sub']).eq('readAt', null)).length;
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList(), 'unreadCount': unread});
  });
  r.patch('/api/v1/notifications/<id>/read', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final notification = await notifications.findOne(where.eq('publicId', id).eq('userId', c['sub']));
    if (notification == null) return reply(404, {'error': 'Notification not found.'});
    await notifications.updateOne(where.eq('publicId', id).eq('userId', c['sub']), modify.set('readAt', now()));
    return reply(200, {'id': id, 'read': true});
  });
  r.post('/api/v1/me/notifications/read-all', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final at = now();
    await notifications.updateMany(where.eq('userId', c['sub']).eq('readAt', null), modify.set('readAt', at));
    return reply(200, {'readAll': true, 'readAt': at});
  });

  r.get('/api/v1/auth/me', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final person = asMap(await users.findOne(where.eq('publicId', claims['sub'])));
    if (person == null || person['status'] != 'active') return unauthenticated();
    return reply(200, {'user': publicDoc(person)});
  });

  r.patch('/api/v1/me/profile', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final name = clean(b['name'], 100);
    final phone = clean(b['phone'], 40);
    if (name.length < 2) return reply(422, {'error': 'Name must contain at least 2 characters.'});
    final at = now();
    await users.updateOne(where.eq('publicId', claims['sub']), modify.set('name', name).set('phone', phone).set('updatedAt', at));
    final updated = asMap(await users.findOne(where.eq('publicId', claims['sub'])));
    if (updated == null) return unauthenticated();
    await audit.insertOne({'eventId': uid.v4(), 'type': 'account.profile_updated', 'subjectId': claims['sub'], 'actorId': claims['sub'], 'createdAt': at});
    return reply(200, {'user': publicDoc(updated), 'updatedAt': at});
  });

  r.patch('/api/v1/me/password', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final currentPassword = b['currentPassword'] is String ? b['currentPassword'] as String : '';
    final newPassword = b['newPassword'] is String ? b['newPassword'] as String : '';
    if (utf8.encode(newPassword).length < 12 || utf8.encode(newPassword).length > 72) {
      return reply(422, {'error': 'New password must be between 12 and 72 UTF-8 bytes.'});
    }
    final person = asMap(await users.findOne(where.eq('publicId', claims['sub'])));
    if (person == null || !passwordMatches(currentPassword, person['passwordHash'])) {
      return reply(401, {'error': 'Current password is incorrect.'});
    }
    if (passwordMatches(newPassword, person['passwordHash'])) {
      return reply(422, {'error': 'Choose a password different from the current password.'});
    }
    final version = (person['tokenVersion'] is int ? person['tokenVersion'] as int : 0) + 1;
    final at = now();
    await users.updateOne(where.eq('publicId', claims['sub']), modify.set('passwordHash', BCrypt.hashpw(newPassword, BCrypt.gensalt())).set('tokenVersion', version).set('updatedAt', at));
    await audit.insertOne({'eventId': uid.v4(), 'type': 'account.password_changed', 'subjectId': claims['sub'], 'actorId': claims['sub'], 'createdAt': at});
    final role = person['role'] as String? ?? 'member';
    final email = person['email'] as String? ?? claims['email']?.toString() ?? '';
    final token = issueToken({'sub': claims['sub'], 'email': email, 'role': role, 'ver': version, 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60 * 60 * 8});
    final updated = asMap(await users.findOne(where.eq('publicId', claims['sub'])));
    return reply(200, {'token': token, 'user': updated == null ? null : publicDoc(updated), 'expiresIn': 28800});
  });

  r.get('/api/v1/me/agent-profile', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final rows = await agentApplications.modernFind(selector: where.eq('userId', claims['sub']), sort: {'updatedAt': -1}, limit: 1).toList();
    return reply(200, {'data': rows.isEmpty ? null : publicDoc(Map<String, dynamic>.from(rows.first), includeReview: true)});
  });
  r.post('/api/v1/agents/apply', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final b = await readJson(q, 40 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final person = asMap(await users.findOne(where.eq('publicId', claims['sub'])));
    if (person == null || person['status'] != 'active') return unauthenticated();
    if (person['role'] == 'admin') return reply(403, {'error': 'Administrator accounts cannot apply for an agent listing.'});
    if (person['role'] == 'agent' && await agentApplications.findOne(where.eq('userId', claims['sub']).eq('status', 'approved')) != null) {
      return reply(409, {'error': 'Your agent profile is already approved. Contact support to request a profile change.'});
    }
    if (await agentApplications.findOne(where.eq('userId', claims['sub']).eq('status', 'pending_review')) != null) {
      return reply(409, {'error': 'Your agent application is already awaiting review.'});
    }
    final phone = clean(b['phone'], 40);
    final bio = clean(b['bio'], 1200);
    final experienceRaw = b['experienceYears'];
    final experience = experienceRaw is num ? experienceRaw.toInt() : int.tryParse('$experienceRaw');
    final rawDistricts = b['districts'];
    final selected = rawDistricts is List ? rawDistricts.whereType<String>().map((x) => clean(x, 60)).toSet().toList() : <String>[];
    final showPhone = b['showPhone'] == true;
    if (phone.length < 7 || bio.length < 50 || experience == null || experience < 0 || experience > 60 ||
        selected.isEmpty || selected.length > 8 || !selected.every(rwandaDistricts.contains)) {
      return reply(422, {'error': 'Provide a phone number, a 50+ character professional bio, 0–60 years of experience, and 1–8 valid Rwanda districts.'});
    }
    final at = now();
    final item = {
      'publicId': uid.v4(), 'userId': claims['sub'], 'name': clean(person['name'], 100),
      'phone': phone, 'showPhone': showPhone, 'bio': bio, 'experienceYears': experience,
      'districts': selected, 'status': 'pending_review', 'createdAt': at, 'updatedAt': at,
    };
    await agentApplications.insertOne(item);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'agent.application_submitted', 'subjectId': item['publicId'], 'actorId': claims['sub'], 'createdAt': at});
    final admins = await users.find(where.eq('role', 'admin').eq('status', 'active')).toList();
    for (final rawAdmin in admins) {
      final admin = Map<String, dynamic>.from(rawAdmin);
      await notifyUser(recipientId: admin['publicId']?.toString(), actorId: claims['sub']?.toString(), type: 'agent_application', title: 'Agent application received', body: 'A professional profile is waiting for review.', destination: 'agent-review', subjectId: item['publicId']?.toString());
    }
    return reply(201, {'data': publicDoc(item, includeReview: true), 'message': 'Agent application sent for review. Your public profile will not appear until approved.'});
  });


  r.get('/api/v1/listings', (Request q) async {
    final p = q.url.queryParameters;
    final filter = <String, dynamic>{'status': 'published'};
    if ((p['district'] ?? '').isNotEmpty && p['district'] != 'All Rwanda') filter['location.district'] = p['district'];
    if ((p['type'] ?? '').isNotEmpty && p['type'] != 'All properties') filter['propertyType'] = p['type']!.toLowerCase();
    if (validPurpose(p['purpose']) != null) filter['purpose'] = p['purpose'];
    final searchText = clean(p['q'], 100);
    if (searchText.isNotEmpty) {
      final escaped = RegExp.escape(searchText);
      filter[r'$or'] = <Map<String, dynamic>>[
        {'title': {r'$regex': escaped, r'$options': 'i'}},
        {'description': {r'$regex': escaped, r'$options': 'i'}},
        {'location.district': {r'$regex': escaped, r'$options': 'i'}},
        {'location.sector': {r'$regex': escaped, r'$options': 'i'}},
      ];
    }
    final max = int.tryParse(p['maxPrice'] ?? '');
    if (max != null && max > 0) filter['price.amount'] = {r'$lte': max};
    final page = (int.tryParse(p['page'] ?? '1') ?? 1).clamp(1, 100000).toInt();
    final limit = (int.tryParse(p['limit'] ?? '24') ?? 24).clamp(1, 60).toInt();
    final sortOrder = p['sort'] == 'price-low'
      ? <String, Object>{'price.amount': 1, 'createdAt': -1}
      : p['sort'] == 'price-high'
        ? <String, Object>{'price.amount': -1, 'createdAt': -1}
        : p['sort'] == 'oldest'
          ? <String, Object>{'createdAt': 1}
          : <String, Object>{'createdAt': -1};
    final query = page > 1
      ? listings.modernFind(filter: filter, limit: limit, skip: (page - 1) * limit, sort: sortOrder)
      : listings.modernFind(filter: filter, limit: limit, sort: sortOrder);
    final docs = await query.toList();
    final items = docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList();
    final total = await listings.count(filter);
    return reply(200, {'data': items, 'page': page, 'limit': limit, 'total': total, 'hasMore': page * limit < total});
  });
  r.get('/api/v1/listings/<id>', (Request q, String id) async {
    final doc = asMap(await listings.findOne(where.eq('publicId', id)));
    if (doc == null || doc['status'] != 'published') return reply(404, {'error': 'Property not found.'});
    return reply(200, {'data': publicDoc(doc)});
  });
  r.post('/api/v1/listings', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final b = await readJson(q, 80 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final title = clean(b['title'], 120), description = clean(b['description'], 3000);
    final loc = asMap(b['location']) ?? {};
    final district = clean(loc['district'], 60), sector = clean(loc['sector'], 80);
    final type = validType(b['propertyType']), purpose = validPurpose(b['purpose']);
    final rawPrice = asMap(b['price'])?['amount'];
    final amount = rawPrice is num && rawPrice == rawPrice.toInt() ? rawPrice.toInt() : int.tryParse('$rawPrice');
    if (title.length < 8 || description.length < 30 || !rwandaDistricts.contains(district) || type == null || purpose == null || amount == null || amount < 1) {
      return reply(422, {'error': 'Title must be 8+ characters, description 30+, a valid Rwanda district, type, purpose and a positive integer RWF price are required.'});
    }
    final id = uid.v4(), createdAt = now();
    final record = <String, dynamic>{
      'publicId': id, 'ownerId': claims['sub'], 'title': title, 'description': description,
      'propertyType': type, 'purpose': purpose, 'location': {'district': district, 'sector': sector},
      'price': {'amount': amount, 'currency': 'RWF', 'period': purpose == 'rent' ? 'month' : 'once'},
      'status': 'pending_review', 'verification': {'status': 'unverified', 'checks': []}, 'images': <dynamic>[],
      'createdAt': createdAt, 'updatedAt': createdAt,
    };
    final digest = sha256.convert(utf8.encode(jsonEncode(record))).toString();
    record['evidenceHash'] = digest;
    await listings.insertOne(record);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.submitted', 'subjectId': id, 'actorId': claims['sub'], 'evidenceHash': digest, 'createdAt': createdAt});
    final admins = await users.find(where.eq('role', 'admin').eq('status', 'active')).toList();
    for (final rawAdmin in admins) {
      final admin = Map<String, dynamic>.from(rawAdmin);
      await notifyUser(recipientId: admin['publicId']?.toString(), actorId: claims['sub']?.toString(), type: 'listing_review', title: 'Property listing submitted', body: 'A new property listing is waiting for review.', destination: 'admin', subjectId: id);
    }
    return reply(201, {'id': id, 'status': 'pending_review', 'evidenceHash': digest, 'message': 'Submitted for human review. It will not appear publicly until approved.'});
  });
  r.get('/api/v1/me/listings', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await listings.modernFind(selector: where.eq('ownerId', c['sub']), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d), includeReview: true)).toList()});
  });

  r.patch('/api/v1/me/listings/<id>', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 80 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final listing = asMap(await listings.findOne(where.eq('publicId', id).eq('ownerId', c['sub'])));
    if (listing == null) return reply(404, {'error': 'Your listing was not found.'});
    if (!['pending_review', 'changes_requested', 'rejected', 'published'].contains(listing['status'])) {
      return reply(409, {'error': 'This listing cannot be edited in its current state.'});
    }
    final title = clean(b['title'], 120), description = clean(b['description'], 3000);
    final loc = asMap(b['location']) ?? {};
    final district = clean(loc['district'], 60), sector = clean(loc['sector'], 80);
    final type = validType(b['propertyType']), purpose = validPurpose(b['purpose']);
    final rawPrice = asMap(b['price'])?['amount'];
    final amount = rawPrice is num && rawPrice == rawPrice.toInt() ? rawPrice.toInt() : int.tryParse('$rawPrice');
    if (title.length < 8 || description.length < 30 || !rwandaDistricts.contains(district) || type == null || purpose == null || amount == null || amount < 1) {
      return reply(422, {'error': 'Title must be 8+ characters, description 30+, a valid Rwanda district, type, purpose and a positive integer RWF price are required.'});
    }
    final at = now();
    final revised = <String, dynamic>{
      'publicId': id, 'ownerId': c['sub'], 'title': title, 'description': description,
      'propertyType': type, 'purpose': purpose, 'location': {'district': district, 'sector': sector},
      'price': {'amount': amount, 'currency': 'RWF', 'period': purpose == 'rent' ? 'month' : 'once'},
      'status': 'pending_review', 'verification': {'status': 'unverified', 'checks': []},
      'updatedAt': at,
    };
    final digest = sha256.convert(utf8.encode(jsonEncode(revised))).toString();
    await listings.updateOne(where.eq('publicId', id).eq('ownerId', c['sub']), modify
      .set('title', title)
      .set('description', description)
      .set('propertyType', type)
      .set('purpose', purpose)
      .set('location', revised['location'])
      .set('price', revised['price'])
      .set('status', 'pending_review')
      .set('verification', revised['verification'])
      .set('reviewNote', '')
      .set('reviewedBy', '')
      .set('updatedAt', at)
      .set('evidenceHash', digest));
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.updated', 'subjectId': id, 'actorId': c['sub'], 'evidenceHash': digest, 'createdAt': at});
    final admins = await users.find(where.eq('role', 'admin').eq('status', 'active')).toList();
    for (final rawAdmin in admins) {
      final admin = Map<String, dynamic>.from(rawAdmin);
      await notifyUser(recipientId: admin['publicId']?.toString(), actorId: c['sub']?.toString(), type: 'listing_review', title: 'Property listing resubmitted', body: 'An edited property listing is waiting for review.', destination: 'admin', subjectId: id);
    }
    return reply(200, {'id': id, 'status': 'pending_review', 'evidenceHash': digest, 'message': 'Saved as a new review version. Public visibility is paused until approval.'});
  });

  r.post('/api/v1/me/listings/<id>/withdraw', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', id).eq('ownerId', c['sub'])));
    if (listing == null) return reply(404, {'error': 'Your listing was not found.'});
    if (!['pending_review', 'changes_requested', 'rejected', 'published'].contains(listing['status'])) {
      return reply(409, {'error': 'This listing is already withdrawn or cannot be withdrawn.'});
    }
    final at = now();
    await listings.updateOne(where.eq('publicId', id).eq('ownerId', c['sub']), modify.set('status', 'withdrawn').set('updatedAt', at));
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.withdrawn', 'subjectId': id, 'actorId': c['sub'], 'createdAt': at});
    return reply(200, {'id': id, 'status': 'withdrawn'});
  });
  r.patch('/api/v1/admin/listings/<id>/review', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    if (c['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final b = await readJson(q, 20 * 1024);
    final decision = clean(b?['decision'], 20);
    final note = clean(b?['note'], 1000);
    if (!['approve', 'reject', 'request_changes'].contains(decision)) return reply(422, {'error': 'Decision must be approve, reject, or request_changes.'});
    final listing = asMap(await listings.findOne(where.eq('publicId', id)));
    if (listing == null) return reply(404, {'error': 'Listing not found.'});
    final status = decision == 'approve' ? 'published' : decision == 'reject' ? 'rejected' : 'changes_requested';
    final at = now();
    await listings.updateOne(where.eq('publicId', id), modify.set('status', status).set('updatedAt', at).set('reviewNote', note).set('reviewedBy', c['sub']));
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.reviewed', 'subjectId': id, 'actorId': c['sub'], 'decision': decision, 'note': note, 'createdAt': at});
    await notifyUser(recipientId: listing['ownerId']?.toString(), actorId: c['sub']?.toString(), type: 'listing_review', title: 'Listing review updated', body: 'Your listing "' + clean(listing['title'], 100) + '" is now ' + status.replaceAll('_', ' ') + (note.isNotEmpty ? '. Note: ' + note : '.'), destination: 'my-listings', subjectId: id);
    return reply(200, {'id': id, 'status': status});
  });
  r.get('/api/v1/admin/listings/pending', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    if (c['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final docs = await listings.modernFind(selector: where.eq('status', 'pending_review'), sort: {'createdAt': 1}, limit: 100).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });

  r.get('/api/v1/admin/agents/pending', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    if (claims['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final docs = await agentApplications.modernFind(selector: where.eq('status', 'pending_review'), sort: {'createdAt': 1}, limit: 100).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d), includeReview: true)).toList()});
  });
  r.patch('/api/v1/admin/agents/<id>/review', (Request q, String id) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    if (claims['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final b = await readJson(q, 20 * 1024);
    final decision = clean(b?['decision'], 20);
    final note = clean(b?['note'], 1000);
    if (!['approve', 'reject', 'request_changes'].contains(decision)) return reply(422, {'error': 'Decision must be approve, reject, or request_changes.'});
    final application = asMap(await agentApplications.findOne(where.eq('publicId', id)));
    if (application == null || !['pending_review', 'changes_requested'].contains(application['status'])) return reply(404, {'error': 'Open agent application not found.'});
    final status = decision == 'approve' ? 'approved' : decision == 'reject' ? 'rejected' : 'changes_requested';
    final at = now();
    await agentApplications.updateOne(where.eq('publicId', id), modify.set('status', status).set('reviewNote', note).set('reviewedBy', claims['sub']).set('updatedAt', at));
    if (decision == 'approve') {
      await users.updateOne(where.eq('publicId', application['userId']), modify.set('role', 'agent'));
    }
    await audit.insertOne({'eventId': uid.v4(), 'type': 'agent.application_reviewed', 'subjectId': id, 'actorId': claims['sub'], 'decision': decision, 'note': note, 'createdAt': at});
    await notifyUser(recipientId: application['userId']?.toString(), actorId: claims['sub']?.toString(), type: 'agent_review', title: 'Agent application reviewed', body: 'Your agent profile application is ' + status.replaceAll('_', ' ') + (note.isNotEmpty ? '. Note: ' + note : '.'), destination: 'agent-application', subjectId: id);
    return reply(200, {'id': id, 'status': status});
  });

  r.get('/api/v1/me/favorites', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await favorites.find(where.eq('userId', c['sub'])).toList();
    return reply(200, {'data': docs.map((d) => {'listingId': d['listingId'], 'createdAt': d['createdAt']}).toList()});
  });
  r.put('/api/v1/favorites/<listingId>', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = await listings.findOne(where.eq('publicId', listingId));
    if (listing == null || listing['status'] != 'published') return reply(404, {'error': 'Published property not found.'});
    final existing = await favorites.findOne(where.eq('userId', c['sub']).eq('listingId', listingId));
    if (existing == null) await favorites.insertOne({'userId': c['sub'], 'listingId': listingId, 'createdAt': now()});
    return reply(200, {'saved': true, 'listingId': listingId});
  });
  r.delete('/api/v1/favorites/<listingId>', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    await favorites.deleteOne(where.eq('userId', c['sub']).eq('listingId', listingId));
    return reply(200, {'saved': false, 'listingId': listingId});
  });

  r.post('/api/v1/leads', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 25 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final listingId = clean(b['listingId'], 80);
    final type = clean(b['type'], 20);
    final message = clean(b['message'], 1000);
    final preferredAt = clean(b['preferredAt'], 50);
    if (!['viewing', 'question', 'offer'].contains(type)) return reply(422, {'error': 'Lead type must be viewing, question or offer.'});
    if (message.length < 5) return reply(422, {'error': 'Add a message of at least five characters.'});
    if (preferredAt.isNotEmpty && DateTime.tryParse(preferredAt) == null) {
      return reply(422, {'error': 'Preferred viewing time must be a valid date and time.'});
    }
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('status', 'published')));
    if (listing == null) return reply(404, {'error': 'Published property not found.'});
    if (listing['ownerId'] == c['sub']) return reply(422, {'error': 'You cannot create a buyer enquiry on your own listing.'});
    final item = {'publicId': uid.v4(), 'listingId': listingId, 'listingTitle': listing['title'], 'ownerId': listing['ownerId'], 'requesterId': c['sub'], 'type': type, 'message': message, 'preferredAt': preferredAt, 'status': 'open', 'createdAt': now()};
    await leads.insertOne(item);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'lead.created', 'subjectId': item['publicId'], 'actorId': c['sub'], 'createdAt': now()});
    await notifyUser(recipientId: listing['ownerId']?.toString(), actorId: c['sub']?.toString(), type: 'lead', title: type == 'viewing' ? 'New viewing request' : type == 'offer' ? 'New offer received' : 'New property question', body: 'Someone sent a request about "' + clean(listing['title'], 100) + '".', destination: 'dashboard', subjectId: item['publicId']?.toString());
    return reply(201, {'data': publicDoc(item)});
  });
  r.get('/api/v1/me/leads', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final all = await leads.modernFind(selector: where.eq('requesterId', c['sub']).or(where.eq('ownerId', c['sub'])), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': all.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });

  r.patch('/api/v1/leads/<id>/status', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 15 * 1024);
    final item = asMap(await leads.findOne(where.eq('publicId', id)));
    if (item == null) return reply(404, {'error': 'Enquiry not found.'});
    final isOwner = item['ownerId'] == c['sub'];
    final isRequester = item['requesterId'] == c['sub'];
    if (!isOwner && !isRequester) return reply(403, {'error': 'Only the enquiry participants can update it.'});
    final status = clean(b?['status'], 30);
    final current = item['status'] as String? ?? 'open';
    final allowed = isOwner
      ? <String, List<String>>{
          'open': ['contacted', 'accepted', 'declined'],
          'contacted': ['accepted', 'declined'],
          'accepted': ['completed'],
        }
      : <String, List<String>>{
          'open': ['cancelled'],
          'contacted': ['cancelled'],
          'accepted': ['cancelled'],
        };
    if (!(allowed[current] ?? <String>[]).contains(status)) {
      return reply(409, {'error': 'This enquiry cannot move from ' + current + ' to ' + status + ' for your role.'});
    }
    final at = now();
    await leads.updateOne(where.eq('publicId', id), modify.set('status', status).set('updatedAt', at).set('lastUpdatedBy', c['sub']));
    await audit.insertOne({'eventId': uid.v4(), 'type': 'lead.status_updated', 'subjectId': id, 'actorId': c['sub'], 'fromStatus': current, 'toStatus': status, 'createdAt': at});
    final recipientId = isOwner ? item['requesterId']?.toString() : item['ownerId']?.toString();
    await notifyUser(recipientId: recipientId, actorId: c['sub']?.toString(), type: 'lead_status', title: 'Enquiry status updated', body: 'Your enquiry about "' + clean(item['listingTitle'], 100) + '" is now ' + status + '.', destination: 'enquiries', subjectId: id);
    return reply(200, {'id': id, 'status': status, 'updatedAt': at});
  });

  r.get('/api/v1/me/conversations', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await conversations.modernFind(selector: where.eq('participants', c['sub']), sort: {'updatedAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/conversations', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final listingId = clean(b['listingId'], 80);
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId)));
    if (listing == null) return reply(404, {'error': 'Property not found.'});
    final ownerId = listing['ownerId']?.toString() ?? '';
    if (ownerId.isEmpty) return reply(409, {'error': 'This listing is not linked to an account that can receive messages.'});
    final isOwner = ownerId == c['sub'];
    final requestedCounterparty = clean(b['participantId'], 80);
    if (isOwner && requestedCounterparty.isEmpty) {
      return reply(422, {'error': 'When replying as a listing owner, provide the participant ID from a valid enquiry.'});
    }
    final counterpartyId = isOwner ? requestedCounterparty : c['sub']!.toString();
    if (counterpartyId == ownerId) return reply(422, {'error': 'You cannot start a conversation with yourself.'});
    final found = asMap(await conversations.findOne(where.eq('listingId', listingId).eq('ownerId', ownerId).eq('counterpartyId', counterpartyId)));
    if (found != null && (found['participants'] as List? ?? []).map((value) => value.toString()).contains(c['sub'].toString())) {
      return reply(200, {'data': publicDoc(found)});
    }
    if (isOwner) {
      final relatedLead = await leads.findOne(where.eq('listingId', listingId).eq('ownerId', ownerId).eq('requesterId', counterpartyId));
      if (relatedLead == null) return reply(403, {'error': 'You can only initiate an owner-side conversation with someone who has enquired about this listing.'});
    } else if (listing['status'] != 'published') {
      final relatedLead = await leads.findOne(where.eq('listingId', listingId).eq('ownerId', ownerId).eq('requesterId', c['sub']));
      final relatedDeal = await deals.findOne(where.eq('listingId', listingId).eq('participants', c['sub']));
      if (relatedLead == null && relatedDeal == null) {
        return reply(404, {'error': 'This property is no longer publicly available for a new conversation.'});
      }
    }
    final createdAt = now();
    final item = {
      'publicId': uid.v4(), 'listingId': listingId, 'listingTitle': listing['title'],
      'ownerId': ownerId, 'counterpartyId': counterpartyId,
      'participants': [ownerId, counterpartyId], 'createdAt': createdAt, 'updatedAt': createdAt,
    };
    await conversations.insertOne(item);
    await notifyUser(
      recipientId: counterpartyId == c['sub'] ? ownerId : counterpartyId,
      actorId: c['sub']?.toString(),
      type: 'conversation',
      title: 'New property conversation',
      body: (isOwner ? 'A property owner opened a conversation about "' : 'A buyer started a conversation about "') + clean(listing['title'], 100) + '".',
      destination: 'messages',
      subjectId: item['publicId']?.toString(),
    );
    return reply(201, {'data': publicDoc(item)});
  });
  r.get('/api/v1/conversations/<id>/messages', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final room = asMap(await conversations.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (room == null) return reply(404, {'error': 'Conversation not found.'});
    final docs = await messages.modernFind(selector: where.eq('conversationId', id), sort: {'createdAt': 1}, limit: 300).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/conversations/<id>/messages', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final room = asMap(await conversations.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (room == null) return reply(404, {'error': 'Conversation not found.'});
    final b = await readJson(q, 20 * 1024);
    final text = clean(b?['text'], 3000);
    if (text.isEmpty) return reply(422, {'error': 'Message cannot be empty.'});
    final item = {'publicId': uid.v4(), 'conversationId': id, 'senderId': c['sub'], 'text': text, 'createdAt': now()};
    await messages.insertOne(item);
    await conversations.updateOne(where.eq('publicId', id), modify.set('updatedAt', now()).set('lastMessage', text.substring(0, text.length > 120 ? 120 : text.length)));
    final participants = List<dynamic>.from(room['participants'] as List? ?? []);
    final recipientId = participants.map((value) => value.toString()).firstWhere((value) => value != c['sub'], orElse: () => '');
    await notifyUser(recipientId: recipientId, actorId: c['sub']?.toString(), type: 'message', title: 'New property message', body: 'A participant sent a message about "' + clean(room['listingTitle'], 100) + '".', destination: 'messages', subjectId: id);
    return reply(201, {'data': publicDoc(item)});
  });

  r.get('/api/v1/me/deals', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await deals.modernFind(selector: where.eq('participants', c['sub']), sort: {'updatedAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/deals', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 25 * 1024);
    final listingId = clean(b?['listingId'], 80);
    final commissionRaw = b?['commissionPercent'];
    final commission = commissionRaw is num ? commissionRaw.toDouble() : double.tryParse('$commissionRaw');
    final terms = clean(b?['commissionTerms'], 1200);
    if (commission == null || commission < 0 || commission > 15 || terms.length < 10) return reply(422, {'error': 'Enter a commission between 0 and 15 percent and describe the agreed fee terms.'});
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('status', 'published')));
    if (listing == null) return reply(404, {'error': 'Published property not found.'});
    final ownerId = listing['ownerId'];
    if (ownerId == c['sub']) return reply(422, {'error': 'You cannot open a deal with yourself.'});
    final item = {'publicId': uid.v4(), 'listingId': listingId, 'listingTitle': listing['title'], 'participants': [c['sub'], ownerId], 'initiatorId': c['sub'], 'commissionPercent': commission, 'commissionTerms': terms, 'feeAcceptedBy': [c['sub']], 'stage': 'proposed', 'history': [{'stage': 'proposed', 'actorId': c['sub'], 'at': now(), 'note': 'Proposal opened'}], 'createdAt': now(), 'updatedAt': now()};
    await deals.insertOne(item);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'deal.created', 'subjectId': item['publicId'], 'actorId': c['sub'], 'createdAt': now()});
    await notifyUser(recipientId: ownerId?.toString(), actorId: c['sub']?.toString(), type: 'deal', title: 'Commission terms proposed', body: 'A deal workspace was opened for "' + clean(listing['title'], 100) + '". Review the proposed terms in your workspace.', destination: 'deals', subjectId: item['publicId']?.toString());
    return reply(201, {'data': publicDoc(item)});
  });
  r.patch('/api/v1/deals/<id>/stage', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 20 * 1024);
    final item = asMap(await deals.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (item == null) return reply(404, {'error': 'Deal not found.'});
    final stage = clean(b?['stage'], 30);
    const stages = ['proposed', 'viewing', 'offer', 'due_diligence', 'agreement', 'completed', 'cancelled'];
    if (!stages.contains(stage)) return reply(422, {'error': 'Unsupported deal stage.'});
    final currentStage = item['stage'] as String? ?? 'proposed';
    const transitions = <String, List<String>>{
      'proposed': ['viewing', 'cancelled'],
      'viewing': ['offer', 'cancelled'],
      'offer': ['due_diligence', 'agreement', 'cancelled'],
      'due_diligence': ['agreement', 'cancelled'],
      'agreement': ['completed', 'cancelled'],
    };
    if (!(transitions[currentStage] ?? <String>[]).contains(stage)) {
      return reply(409, {'error': 'Invalid deal transition from ' + currentStage + ' to ' + stage + '. Review the current milestone before moving forward.'});
    }
    final accepted = List<dynamic>.from(item['feeAcceptedBy'] as List? ?? []);
    if (stage == 'agreement' && accepted.toSet().length < 2) {
      return reply(409, {'error': 'Both participants must acknowledge the written commission terms before the deal can move to agreement.'});
    }
    final history = List<dynamic>.from(item['history'] as List? ?? []);
    List<dynamic>? completionConfirmations;
    final participants = List<dynamic>.from(item['participants'] as List? ?? []);
    final recipientId = participants.map((value) => value.toString()).firstWhere((value) => value != c['sub'], orElse: () => '');
    final at = now();
    if (stage == 'completed') {
      final confirmations = List<dynamic>.from(item['completionConfirmedBy'] as List? ?? []);
      completionConfirmations = confirmations;
      final alreadyConfirmed = confirmations.map((value) => value.toString()).contains(c['sub'].toString());
      if (!alreadyConfirmed) confirmations.add(c['sub']);
      if (confirmations.map((value) => value.toString()).toSet().length < 2) {
        if (!alreadyConfirmed) {
          history.add({'stage': 'completion_confirmation_pending', 'actorId': c['sub'], 'at': at, 'note': 'Participant requested completion confirmation'});
          await deals.updateOne(where.eq('publicId', id), modify
            .set('completionConfirmedBy', confirmations)
            .set('updatedAt', at)
            .set('history', history));
          await audit.insertOne({'eventId': uid.v4(), 'type': 'deal.completion_confirmation_requested', 'subjectId': id, 'actorId': c['sub'], 'createdAt': at});
          await notifyUser(recipientId: recipientId, actorId: c['sub']?.toString(), type: 'deal_completion', title: 'Confirm deal completion', body: 'The other participant says the deal for "' + clean(item['listingTitle'], 100) + '" is complete. Confirm it in your workspace to close the record.', destination: 'deals', subjectId: id);
        }
        return reply(200, {'id': id, 'stage': currentStage, 'completionPending': true, 'completionConfirmedBy': confirmations, 'history': history});
      }
      history.add({'stage': stage, 'actorId': c['sub'], 'at': at, 'note': clean(b?['note'], 500)});
      completionConfirmations = confirmations;
      await deals.updateOne(where.eq('publicId', id), modify
        .set('stage', stage)
        .set('completionConfirmedBy', confirmations)
        .set('updatedAt', at)
        .set('history', history));
    } else {
      history.add({'stage': stage, 'actorId': c['sub'], 'at': at, 'note': clean(b?['note'], 500)});
      await deals.updateOne(where.eq('publicId', id), modify.set('stage', stage).set('updatedAt', at).set('history', history));
    }
    await notifyUser(recipientId: recipientId, actorId: c['sub']?.toString(), type: stage == 'completed' ? 'deal_completion' : 'deal_stage', title: stage == 'completed' ? 'Deal completed by both parties' : 'Deal milestone updated', body: 'The deal for "' + clean(item['listingTitle'], 100) + '" moved to ' + prettyStageForNotification(stage) + '.', destination: 'deals', subjectId: id);
    await audit.insertOne({'eventId': uid.v4(), 'type': stage == 'completed' ? 'deal.completed' : 'deal.stage_updated', 'subjectId': id, 'actorId': c['sub'], 'stage': stage, 'createdAt': at});
    return reply(200, {'id': id, 'stage': stage, 'completionConfirmedBy': completionConfirmations, 'history': history});
  });
  r.post('/api/v1/deals/<id>/accept-fee', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final item = asMap(await deals.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (item == null) return reply(404, {'error': 'Deal not found.'});
    if (['completed', 'cancelled'].contains(item['stage'])) {
      return reply(409, {'error': 'Closed deals cannot accept or change commission acknowledgement.'});
    }
    final accepted = List<dynamic>.from(item['feeAcceptedBy'] as List? ?? []);
    if (!accepted.contains(c['sub'])) accepted.add(c['sub']);
    await deals.updateOne(where.eq('publicId', id), modify.set('feeAcceptedBy', accepted).set('updatedAt', now()));
    final participants = List<dynamic>.from(item['participants'] as List? ?? []);
    final recipientId = participants.map((value) => value.toString()).firstWhere((value) => value != c['sub'], orElse: () => '');
    await notifyUser(recipientId: recipientId, actorId: c['sub']?.toString(), type: 'fee_acceptance', title: 'Commission terms acknowledged', body: 'A participant acknowledged fee terms for "' + clean(item['listingTitle'], 100) + '".', destination: 'deals', subjectId: id);
    return reply(200, {'id': id, 'feeAcceptedBy': accepted, 'fullyAccepted': accepted.length >= 2});
  });

  r.post('/api/v1/me/listings/<listingId>/images', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('ownerId', c['sub'])));
    if (listing == null) return reply(404, {'error': 'Your listing was not found.'});
    if (!['pending_review', 'changes_requested', 'rejected', 'published'].contains(listing['status'])) {
      return reply(409, {'error': 'Photos cannot be changed in this listing state.'});
    }
    final currentImageCount = (listing['images'] as List? ?? []).length;
    if (currentImageCount >= 6) {
      return reply(409, {'error': 'A listing can have at most six photos. Remove a photo before uploading another.'});
    }
    final b = await readJson(q, 11 * 1024 * 1024);
    if (b == null) return reply(413, {'error': 'Image request is too large or invalid. Maximum file size is 8 MiB.'});
    final fileName = clean(b['fileName'], 180);
    final altText = clean(b['altText'], 180);
    final mime = clean(b['contentType'], 80).toLowerCase();
    final base64Data = b['base64'] is String ? b['base64'] as String : '';
    const allowed = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};
    if (fileName.isEmpty || !allowed.containsKey(mime) || base64Data.isEmpty) {
      return reply(422, {'error': 'Only JPEG, PNG and WebP property photos are allowed.'});
    }
    List<int> bytes;
    try { bytes = base64Decode(base64Data); } catch (_) { return reply(422, {'error': 'The uploaded image is not valid Base64 data.'}); }
    if (bytes.isEmpty || bytes.length > 8 * 1024 * 1024) return reply(413, {'error': 'Maximum photo size is 8 MiB.'});
    if (!hasAllowedFileSignature(mime, bytes)) {
      return reply(422, {'error': 'Image signature does not match the selected file type.'});
    }
    final id = uid.v4(), ext = allowed[mime]!, at = now();
    final directory = Directory(listingImageRoot); await directory.create(recursive: true);
    final path = listingImageRoot + Platform.pathSeparator + id + '.' + ext;
    await File(path).writeAsBytes(bytes, flush: true);
    final image = {
      'publicId': id, 'listingId': listingId, 'uploadedBy': c['sub'],
      'fileName': fileName, 'altText': altText.isEmpty ? 'Property photograph' : altText,
      'contentType': mime, 'sizeBytes': bytes.length, 'filePath': path, 'createdAt': at,
    };
    await listingImages.insertOne(image);
    final imageCards = List<dynamic>.from(listing['images'] as List? ?? []);
    imageCards.add({'publicId': id, 'alt': image['altText'], 'contentType': mime, 'sizeBytes': bytes.length});
    await listings.updateOne(where.eq('publicId', listingId).eq('ownerId', c['sub']), modify
      .set('images', imageCards)
      .set('status', 'pending_review')
      .set('verification', {'status': 'unverified', 'checks': []})
      .set('reviewNote', '')
      .set('reviewedBy', '')
      .set('updatedAt', at));
    final digest = sha256.convert(bytes).toString();
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.image_uploaded', 'subjectId': id, 'actorId': c['sub'], 'evidenceHash': digest, 'createdAt': at});
    final admins = await users.find(where.eq('role', 'admin').eq('status', 'active')).toList();
    for (final rawAdmin in admins) {
      final admin = Map<String, dynamic>.from(rawAdmin);
      await notifyUser(recipientId: admin['publicId']?.toString(), actorId: c['sub']?.toString(), type: 'listing_review', title: 'Property photo needs review', body: 'A property listing photo was added or changed.', destination: 'admin', subjectId: listingId);
    }
    return reply(201, {'data': publicDoc(image), 'sha256': digest, 'status': 'pending_review', 'message': 'Photo stored. The listing is pending review before it can be shown publicly.'});
  });

  r.delete('/api/v1/me/listings/<listingId>/images/<imageId>', (Request q, String listingId, String imageId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('ownerId', c['sub'])));
    if (listing == null) return reply(404, {'error': 'Your listing was not found.'});
    if (!['pending_review', 'changes_requested', 'rejected', 'published'].contains(listing['status'])) {
      return reply(409, {'error': 'Photos cannot be changed in this listing state.'});
    }
    final image = asMap(await listingImages.findOne(where.eq('publicId', imageId).eq('listingId', listingId).eq('uploadedBy', c['sub'])));
    if (image == null) return reply(404, {'error': 'Property photo not found.'});
    final current = List<dynamic>.from(listing['images'] as List? ?? []);
    final updated = current.where((raw) => raw is! Map || raw['publicId'] != imageId).toList();
    final at = now();
    await listings.updateOne(where.eq('publicId', listingId).eq('ownerId', c['sub']), modify
      .set('images', updated)
      .set('status', 'pending_review')
      .set('verification', {'status': 'unverified', 'checks': []})
      .set('reviewNote', '')
      .set('reviewedBy', '')
      .set('updatedAt', at));
    await listingImages.deleteOne(where.eq('publicId', imageId).eq('listingId', listingId));
    final file = File(image['filePath'] as String);
    if (await file.exists()) await file.delete();
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.image_removed', 'subjectId': imageId, 'actorId': c['sub'], 'createdAt': at});
    return reply(200, {'id': imageId, 'status': 'pending_review', 'message': 'Photo removed. The listing remains under review.'});
  });

  r.get('/api/v1/listing-images/<id>', (Request q, String id) async {
    final image = asMap(await listingImages.findOne(where.eq('publicId', id)));
    if (image == null) return reply(404, {'error': 'Property photo not found.'});
    final listing = asMap(await listings.findOne(where.eq('publicId', image['listingId'])));
    if (listing == null) return reply(404, {'error': 'Property photo not found.'});
    final imageIsAttached = (listing['images'] as List? ?? []).any((raw) => raw is Map && raw['publicId'] == id);
    if (!imageIsAttached) return reply(404, {'error': 'Property photo is no longer attached to a listing.'});
    final isPublic = listing['status'] == 'published';
    if (!isPublic) {
      final c = await currentUser(q, users);
      if (c == null) return unauthenticated();
      if (listing['ownerId'] != c['sub'] && c['role'] != 'admin') return reply(403, {'error': 'You are not authorized to view this unpublished property photo.'});
    }
    final file = File(image['filePath'] as String);
    if (!await file.exists()) return reply(410, {'error': 'The property photo file is no longer available.'});
    return Response.ok(await file.readAsBytes(), headers: {
      'content-type': image['contentType'] as String? ?? 'application/octet-stream',
      'content-disposition': 'inline; filename="property-photo-' + id + '"',
      'cache-control': isPublic ? 'public, max-age=3600' : 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
  });

  r.get('/api/v1/listings/<listingId>/documents', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId)));
    if (listing == null) return reply(404, {'error': 'Property not found.'});
    final isOwner = listing['ownerId'] == c['sub'];
    final isAdmin = c['role'] == 'admin';
    final inDeal = await deals.findOne(where.eq('listingId', listingId).eq('participants', c['sub'])) != null;
    if (!isOwner && !isAdmin && !inDeal) return reply(403, {'error': 'Only the listing owner, an administrator reviewer or a deal participant can view document metadata.'});
    final docs = await documents.modernFind(selector: where.eq('listingId', listingId), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/listings/<listingId>/documents', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId)));
    if (listing == null) return reply(404, {'error': 'Property not found.'});
    if (listing['ownerId'] != c['sub']) return reply(403, {'error': 'Only the listing owner can upload evidence.'});
    if (!['pending_review', 'changes_requested', 'rejected', 'published'].contains(listing['status'])) {
      return reply(409, {'error': 'Evidence cannot be changed for a withdrawn listing.'});
    }
    final b = await readJson(q, 11 * 1024 * 1024);
    if (b == null) return reply(413, {'error': 'Document request is too large or invalid. Maximum file size is 8 MiB.'});
    final fileName = clean(b['fileName'], 180);
    final mime = clean(b['contentType'], 80).toLowerCase();
    final base64Data = b['base64'] is String ? b['base64'] as String : '';
    const allowed = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'};
    if (fileName.isEmpty || !allowed.containsKey(mime) || base64Data.isEmpty) return reply(422, {'error': 'Only PDF, JPEG, PNG and WebP evidence files are allowed.'});
    List<int> bytes;
    try { bytes = base64Decode(base64Data); } catch (_) { return reply(422, {'error': 'The uploaded file is not valid Base64 data.'}); }
    if (bytes.isEmpty || bytes.length > 8 * 1024 * 1024) return reply(413, {'error': 'Maximum file size is 8 MiB.'});
    if (!hasAllowedFileSignature(mime, bytes)) {
      return reply(422, {'error': 'File signature does not match the selected file type.'});
    }
    final id = uid.v4(), ext = allowed[mime]!;
    final directory = Directory(storageRoot); await directory.create(recursive: true);
    final path = storageRoot + Platform.pathSeparator + id + '.' + ext;
    await File(path).writeAsBytes(bytes, flush: true);
    final doc = {'publicId': id, 'listingId': listingId, 'uploadedBy': c['sub'], 'fileName': fileName, 'contentType': mime, 'sizeBytes': bytes.length, 'filePath': path, 'createdAt': now(), 'reviewStatus': 'not_reviewed'};
    await documents.insertOne(doc);
    final digest = sha256.convert(bytes).toString();
    final at = now();
    await listings.updateOne(where.eq('publicId', listingId).eq('ownerId', c['sub']), modify
      .set('status', 'pending_review')
      .set('verification', {'status': 'unverified', 'checks': []})
      .set('reviewNote', '')
      .set('reviewedBy', '')
      .set('updatedAt', at));
    await audit.insertOne({'eventId': uid.v4(), 'type': 'document.uploaded', 'subjectId': id, 'actorId': c['sub'], 'evidenceHash': digest, 'createdAt': at});
    final admins = await users.find(where.eq('role', 'admin').eq('status', 'active')).toList();
    for (final rawAdmin in admins) {
      final admin = Map<String, dynamic>.from(rawAdmin);
      await notifyUser(recipientId: admin['publicId']?.toString(), actorId: c['sub']?.toString(), type: 'listing_review', title: 'Property evidence added', body: 'A private evidence file was added to a listing and requires review.', destination: 'admin', subjectId: listingId);
    }
    return reply(201, {'data': publicDoc(doc), 'sha256': digest, 'status': 'pending_review', 'note': 'Stored privately. The digest proves a specific byte sequence was recorded, not that the document is genuine. The listing is back in review.'});
  });
  r.patch('/api/v1/admin/documents/<id>/review', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    if (c['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final b = await readJson(q, 20 * 1024);
    final decision = clean(b?['decision'], 20);
    final note = clean(b?['note'], 1000);
    if (!['approve', 'reject', 'request_changes'].contains(decision)) {
      return reply(422, {'error': 'Decision must be approve, reject, or request_changes.'});
    }
    final doc = asMap(await documents.findOne(where.eq('publicId', id)));
    if (doc == null) return reply(404, {'error': 'Evidence document not found.'});
    final listing = asMap(await listings.findOne(where.eq('publicId', doc['listingId'])));
    final status = decision == 'approve' ? 'verified' : decision == 'reject' ? 'rejected' : 'changes_requested';
    final at = now();
    await documents.updateOne(where.eq('publicId', id), modify
      .set('reviewStatus', status)
      .set('reviewNote', note)
      .set('reviewedBy', c['sub'])
      .set('reviewedAt', at));
    final uploadEvent = asMap(await audit.findOne(where.eq('subjectId', id).eq('type', 'document.uploaded')));
    await audit.insertOne({
      'eventId': uid.v4(), 'type': 'document.reviewed', 'subjectId': id, 'actorId': c['sub'],
      'decision': decision, 'note': note, 'evidenceHash': uploadEvent?['evidenceHash'], 'createdAt': at,
    });
    if (listing != null) {
      await notifyUser(
        recipientId: listing['ownerId']?.toString(), actorId: c['sub']?.toString(),
        type: 'listing_review', title: 'Evidence review updated',
        body: 'Evidence "' + clean(doc['fileName'], 120) + '" was marked ' + status.replaceAll('_', ' ') + (note.isNotEmpty ? '. Note: ' + note : '.'),
        destination: 'my-listings', subjectId: doc['listingId']?.toString(),
      );
    }
    final updated = asMap(await documents.findOne(where.eq('publicId', id)));
    return reply(200, {'data': publicDoc(updated ?? doc), 'status': status, 'message': 'Evidence review recorded: ' + status.replaceAll('_', ' ') + '.'});
  });

  r.get('/api/v1/documents/<id>/download', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final doc = asMap(await documents.findOne(where.eq('publicId', id)));
    if (doc == null) return reply(404, {'error': 'Document not found.'});
    final listing = asMap(await listings.findOne(where.eq('publicId', doc['listingId'])));
    final owner = listing?['ownerId'] == c['sub'];
    final uploader = doc['uploadedBy'] == c['sub'];
    final isAdmin = c['role'] == 'admin';
    final inDeal = await deals.findOne(where.eq('listingId', doc['listingId']).eq('participants', c['sub'])) != null;
    if (!owner && !uploader && !isAdmin && !inDeal) return reply(403, {'error': 'You are not authorized to download this document.'});
    final file = File(doc['filePath'] as String);
    if (!await file.exists()) return reply(410, {'error': 'The private document file is no longer available.'});
    return Response.ok(await file.readAsBytes(), headers: {
      'content-type': doc['contentType'] as String? ?? 'application/octet-stream',
      'content-disposition': 'attachment; filename="evidence-' + id + '"',
      'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    });
  });
  r.get('/api/v1/trust/verify/<hash>', (Request q, String hash) async {
    final found = await audit.findOne(where.eq('evidenceHash', hash));
    return reply(200, {'exists': found != null, 'meaning': 'A matching digest was logged. This does not prove ownership, authenticity, legal validity, or an official land title.'});
  });

  final handler = Pipeline().addMiddleware(logRequests()).addMiddleware((inner) => (req) async {
    final origin = req.headers['origin'];
    final allowOrigin = origin != null && allowedWebOrigins.contains(origin) ? origin : null;
    final corsHeaders = <String, String>{
      if (allowOrigin != null) 'access-control-allow-origin': allowOrigin,
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Origin, Content-Type, Accept, Authorization',
      'access-control-max-age': '600',
      'vary': 'Origin',
    };
    if (req.method == 'OPTIONS') return Response(204, headers: corsHeaders);
    final res = await inner(req);
    return res.change(headers: {
      ...corsHeaders,
      'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
    });
  }).addHandler(r.call);
  final server = await io.serve(handler, InternetAddress.anyIPv4, port);
  stdout.writeln('KOMISIYONERI API listening on ' + server.port.toString());
}
