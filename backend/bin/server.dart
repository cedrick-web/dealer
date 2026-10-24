import 'dart:convert';
import 'dart:io';
import 'package:bcrypt/bcrypt.dart';
import 'package:crypto/crypto.dart';
import 'package:mongo_dart/mongo_dart.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as io;
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

final uid = const Uuid();
final secret = Platform.environment['JWT_SECRET'] ?? 'development-only-change-me-before-deploying';
final storageRoot = Platform.environment['DOCUMENT_STORAGE'] ?? '/data/private-documents';
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
  // Roles and account status are taken from MongoDB on every protected request,
  // so an expired/disabled/demoted account cannot keep stale access through a token.
  return <String, dynamic>{
    ...claims,
    'role': person['role'] as String? ?? 'member',
    'email': person['email'] as String? ?? claims['email'],
  };
}

Future<Map<String, dynamic>?> readJson(Request req, [int maxBytes = 1024 * 1024]) async {
  final declared = int.tryParse(req.headers['content-length'] ?? '');
  if (declared != null && declared > maxBytes) return null;
  final raw = await req.readAsString();
  if (utf8.encode(raw).length > maxBytes) return null;
  try {
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
String? validPurpose(dynamic v) => ['sale', 'rent'].contains(v) ? v as String : null;
String? validType(dynamic v) => ['house', 'apartment', 'land', 'commercial', 'room'].contains(v) ? v as String : null;
Map<String, dynamic> publicDoc(Map<String, dynamic> source, {bool includeReview = false}) {
  final out = Map<String, dynamic>.from(source);
  out.remove('_id'); out.remove('passwordHash'); out.remove('evidenceHash');
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
  final agentApplications = db.collection('agent_applications');

  // Optional first-run admin bootstrap. Never expose an admin role in public registration.
  final adminEmail = (Platform.environment['BOOTSTRAP_ADMIN_EMAIL'] ?? '').trim().toLowerCase();
  final adminPassword = Platform.environment['BOOTSTRAP_ADMIN_PASSWORD'] ?? '';
  if (adminEmail.isNotEmpty && adminPassword.length >= 14 && !adminPassword.startsWith('CHANGE_ME') && await users.findOne(where.eq('email', adminEmail)) == null) {
    await users.insertOne({
      'publicId': uid.v4(), 'name': 'Platform administrator', 'email': adminEmail,
      'passwordHash': BCrypt.hashpw(adminPassword, BCrypt.gensalt()), 'role': 'admin',
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
    final docs = await agentApplications.find(where.eq('status', 'approved'), sort: {'updatedAt': -1}, limit: 100).toList();
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
    if (name.length < 2 || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+
      return reply(422, {'error': 'Enter your name, a valid email, and a password of 10–72 UTF-8 bytes.'});
    }
    if (await users.findOne(where.eq('email', email)) != null) return reply(409, {'error': 'An account with that email already exists.'});
    final person = {
      'publicId': uid.v4(), 'name': name, 'email': email, 'phone': phone,
      'passwordHash': BCrypt.hashpw(password, BCrypt.gensalt()), 'role': 'member',
      'status': 'active', 'createdAt': now(),
    };
    await users.insertOne(person);
    final token = issueToken({'sub': person['publicId'], 'email': email, 'role': 'member', 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60 * 60 * 8});
    return reply(201, {'token': token, 'user': publicDoc(person), 'expiresIn': 28800});
  });
  r.post('/api/v1/auth/login', (Request q) async {
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final email = clean(b['email'], 160).toLowerCase();
    final password = b['password'] is String ? b['password'] as String : '';
    if (utf8.encode(password).length > 72) return reply(401, {'error': 'Email or password is incorrect.'});
    final person = asMap(await users.findOne(where.eq('email', email)));
    if (person == null || person['status'] != 'active' || !BCrypt.checkpw(password, person['passwordHash'] as String? ?? '')) {
      return reply(401, {'error': 'Email or password is incorrect.'});
    }
    final role = person['role'] as String? ?? 'member';
    final token = issueToken({'sub': person['publicId'], 'email': email, 'role': role, 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60 * 60 * 8});
    return reply(200, {'token': token, 'user': publicDoc(person), 'expiresIn': 28800});
  });
  r.get('/api/v1/auth/me', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final person = asMap(await users.findOne(where.eq('publicId', claims['sub'])));
    if (person == null || person['status'] != 'active') return unauthenticated();
    return reply(200, {'user': publicDoc(person)});
  });

  r.get('/api/v1/me/agent-profile', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final rows = await agentApplications.find(where.eq('userId', claims['sub']), sort: {'updatedAt': -1}, limit: 1).toList();
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
    return reply(201, {'data': publicDoc(item, includeReview: true), 'message': 'Agent application sent for review. Your public profile will not appear until approved.'});
  });


  r.get('/api/v1/listings', (Request q) async {
    final p = q.url.queryParameters;
    final filter = <String, dynamic>{'status': 'published'};
    if ((p['district'] ?? '').isNotEmpty && p['district'] != 'All Rwanda') filter['location.district'] = p['district'];
    if ((p['type'] ?? '').isNotEmpty && p['type'] != 'All properties') filter['propertyType'] = p['type']!.toLowerCase();
    if (validPurpose(p['purpose']) != null) filter['purpose'] = p['purpose'];
    final max = int.tryParse(p['maxPrice'] ?? '');
    if (max != null && max > 0) filter['price.amount'] = {'$lte': max};
    final page = (int.tryParse(p['page'] ?? '1') ?? 1).clamp(1, 100000);
    final limit = (int.tryParse(p['limit'] ?? '24') ?? 24).clamp(1, 60);
    final docs = await listings.find(filter, limit: limit, skip: (page - 1) * limit, sort: {'createdAt': -1}).toList();
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
    final amount = rawPrice is num ? rawPrice.toInt() : int.tryParse('$rawPrice');
    if (title.length < 8 || description.length < 30 || district.isEmpty || type == null || purpose == null || amount == null || amount < 1) {
      return reply(422, {'error': 'Title must be 8+ characters, description 30+, and district, type, purpose and a positive RWF price are required.'});
    }
    final id = uid.v4(), createdAt = now();
    final record = <String, dynamic>{
      'publicId': id, 'ownerId': claims['sub'], 'title': title, 'description': description,
      'propertyType': type, 'purpose': purpose, 'location': {'district': district, 'sector': sector},
      'price': {'amount': amount, 'currency': 'RWF', 'period': purpose == 'rent' ? 'month' : 'once'},
      'status': 'pending_review', 'verification': {'status': 'unverified', 'checks': []},
      'createdAt': createdAt, 'updatedAt': createdAt,
    };
    final digest = sha256.convert(utf8.encode(jsonEncode(record))).toString();
    record['evidenceHash'] = digest;
    await listings.insertOne(record);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.submitted', 'subjectId': id, 'actorId': claims['sub'], 'evidenceHash': digest, 'createdAt': createdAt});
    return reply(201, {'id': id, 'status': 'pending_review', 'evidenceHash': digest, 'message': 'Submitted for human review. It will not appear publicly until approved.'});
  });
  r.get('/api/v1/me/listings', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await listings.find(where.eq('ownerId', c['sub']), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d), includeReview: true)).toList()});
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
    return reply(200, {'id': id, 'status': status});
  });
  r.get('/api/v1/admin/listings/pending', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    if (c['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final docs = await listings.find(where.eq('status', 'pending_review'), sort: {'createdAt': 1}).limit(100).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });

  r.get('/api/v1/admin/agents/pending', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    if (claims['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final docs = await agentApplications.find(where.eq('status', 'pending_review'), sort: {'createdAt': 1}).limit(100).toList();
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
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('status', 'published')));
    if (listing == null) return reply(404, {'error': 'Published property not found.'});
    if (listing['ownerId'] == c['sub']) return reply(422, {'error': 'You cannot create a buyer enquiry on your own listing.'});
    final item = {'publicId': uid.v4(), 'listingId': listingId, 'listingTitle': listing['title'], 'ownerId': listing['ownerId'], 'requesterId': c['sub'], 'type': type, 'message': message, 'preferredAt': preferredAt, 'status': 'open', 'createdAt': now()};
    await leads.insertOne(item);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'lead.created', 'subjectId': item['publicId'], 'actorId': c['sub'], 'createdAt': now()});
    return reply(201, {'data': publicDoc(item)});
  });
  r.get('/api/v1/me/leads', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final all = await leads.find(where.eq('requesterId', c['sub']).or(where.eq('ownerId', c['sub'])), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': all.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });

  r.get('/api/v1/me/conversations', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await conversations.find(where.eq('participants', c['sub']), sort: {'updatedAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/conversations', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final listingId = clean(b['listingId'], 80);
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('status', 'published')));
    if (listing == null) return reply(404, {'error': 'Published property not found.'});
    final ownerId = listing['ownerId'];
    if (ownerId == c['sub']) return reply(422, {'error': 'You cannot start a conversation with yourself.'});
    final found = asMap(await conversations.findOne(where.eq('listingId', listingId).eq('participants', c['sub']).eq('ownerId', ownerId)));
    if (found != null) return reply(200, {'data': publicDoc(found)});
    final item = {'publicId': uid.v4(), 'listingId': listingId, 'listingTitle': listing['title'], 'ownerId': ownerId, 'participants': [c['sub'], ownerId], 'createdAt': now(), 'updatedAt': now()};
    await conversations.insertOne(item);
    return reply(201, {'data': publicDoc(item)});
  });
  r.get('/api/v1/conversations/<id>/messages', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final room = asMap(await conversations.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (room == null) return reply(404, {'error': 'Conversation not found.'});
    final docs = await messages.find(where.eq('conversationId', id), sort: {'createdAt': 1}).limit(300).toList();
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
    return reply(201, {'data': publicDoc(item)});
  });

  r.get('/api/v1/me/deals', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await deals.find(where.eq('participants', c['sub']), sort: {'updatedAt': -1}).toList();
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
    if (item['stage'] == 'completed' || item['stage'] == 'cancelled') return reply(409, {'error': 'Closed deals cannot be advanced.'});
    final history = List<dynamic>.from(item['history'] as List? ?? []);
    history.add({'stage': stage, 'actorId': c['sub'], 'at': now(), 'note': clean(b?['note'], 500)});
    await deals.updateOne(where.eq('publicId', id), modify.set('stage', stage).set('updatedAt', now()).set('history', history));
    return reply(200, {'id': id, 'stage': stage, 'history': history});
  });
  r.post('/api/v1/deals/<id>/accept-fee', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final item = asMap(await deals.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (item == null) return reply(404, {'error': 'Deal not found.'});
    final accepted = List<dynamic>.from(item['feeAcceptedBy'] as List? ?? []);
    if (!accepted.contains(c['sub'])) accepted.add(c['sub']);
    await deals.updateOne(where.eq('publicId', id), modify.set('feeAcceptedBy', accepted).set('updatedAt', now()));
    return reply(200, {'id': id, 'feeAcceptedBy': accepted, 'fullyAccepted': accepted.length >= 2});
  });

  r.get('/api/v1/listings/<listingId>/documents', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId)));
    if (listing == null) return reply(404, {'error': 'Property not found.'});
    final isOwner = listing['ownerId'] == c['sub'];
    final isAdmin = c['role'] == 'admin';
    final inDeal = await deals.findOne(where.eq('listingId', listingId).eq('participants', c['sub'])) != null;
    if (!isOwner && !isAdmin && !inDeal) return reply(403, {'error': 'Only the listing owner, an administrator reviewer or a deal participant can view document metadata.'});
    final docs = await documents.find(where.eq('listingId', listingId), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/listings/<listingId>/documents', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId)));
    if (listing == null) return reply(404, {'error': 'Property not found.'});
    if (listing['ownerId'] != c['sub']) return reply(403, {'error': 'Only the listing owner can upload evidence.'});
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
    final prefix = bytes.take(16).toList();
    final validMagic = mime == 'application/pdf' ? utf8.decode(prefix.take(4).toList(), allowMalformed: true) == '%PDF'
      : mime == 'image/jpeg' ? prefix.length >= 3 && prefix[0] == 255 && prefix[1] == 216 && prefix[2] == 255
      : mime == 'image/png' ? prefix.length >= 8 && prefix[0] == 137 && prefix[1] == 80 && prefix[2] == 78 && prefix[3] == 71
      : prefix.length >= 12 && prefix[0] == 82 && prefix[1] == 73 && prefix[2] == 70 && prefix[3] == 70 && prefix[8] == 87 && prefix[9] == 69 && prefix[10] == 66 && prefix[11] == 80;
    if (!validMagic) return reply(422, {'error': 'File signature does not match the selected file type.'});
    final id = uid.v4(), ext = allowed[mime]!;
    final directory = Directory(storageRoot); await directory.create(recursive: true);
    final path = storageRoot + Platform.pathSeparator + id + '.' + ext;
    await File(path).writeAsBytes(bytes, flush: true);
    final doc = {'publicId': id, 'listingId': listingId, 'uploadedBy': c['sub'], 'fileName': fileName, 'contentType': mime, 'sizeBytes': bytes.length, 'filePath': path, 'createdAt': now(), 'reviewStatus': 'not_reviewed'};
    await documents.insertOne(doc);
    final digest = sha256.convert(bytes).toString();
    await audit.insertOne({'eventId': uid.v4(), 'type': 'document.uploaded', 'subjectId': id, 'actorId': c['sub'], 'evidenceHash': digest, 'createdAt': now()});
    return reply(201, {'data': publicDoc(doc), 'sha256': digest, 'note': 'Stored privately. The digest proves a specific byte sequence was recorded, not that the document is genuine.'});
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
).hasMatch(email) || password.length < 10 || utf8.encode(password).length > 72) {
      return reply(422, {'error': 'Enter your name, a valid email, and a password of at least 10 characters.'});
    }
    if (await users.findOne(where.eq('email', email)) != null) return reply(409, {'error': 'An account with that email already exists.'});
    final person = {
      'publicId': uid.v4(), 'name': name, 'email': email, 'phone': phone,
      'passwordHash': BCrypt.hashpw(password, BCrypt.gensalt()), 'role': 'member',
      'status': 'active', 'createdAt': now(),
    };
    await users.insertOne(person);
    final token = issueToken({'sub': person['publicId'], 'email': email, 'role': 'member', 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60 * 60 * 8});
    return reply(201, {'token': token, 'user': publicDoc(person), 'expiresIn': 28800});
  });
  r.post('/api/v1/auth/login', (Request q) async {
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final email = clean(b['email'], 160).toLowerCase();
    final password = b['password'] is String ? b['password'] as String : '';
    final person = asMap(await users.findOne(where.eq('email', email)));
    if (person == null || person['status'] != 'active' || !BCrypt.checkpw(password, person['passwordHash'] as String? ?? '')) {
      return reply(401, {'error': 'Email or password is incorrect.'});
    }
    final role = person['role'] as String? ?? 'member';
    final token = issueToken({'sub': person['publicId'], 'email': email, 'role': role, 'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60 * 60 * 8});
    return reply(200, {'token': token, 'user': publicDoc(person), 'expiresIn': 28800});
  });
  r.get('/api/v1/auth/me', (Request q) async {
    final claims = await currentUser(q, users); if (claims == null) return unauthenticated();
    final person = asMap(await users.findOne(where.eq('publicId', claims['sub'])));
    if (person == null || person['status'] != 'active') return unauthenticated();
    return reply(200, {'user': publicDoc(person)});
  });

  r.get('/api/v1/listings', (Request q) async {
    final p = q.url.queryParameters;
    final filter = <String, dynamic>{'status': 'published'};
    if ((p['district'] ?? '').isNotEmpty && p['district'] != 'All Rwanda') filter['location.district'] = p['district'];
    if ((p['type'] ?? '').isNotEmpty && p['type'] != 'All properties') filter['propertyType'] = p['type']!.toLowerCase();
    if (validPurpose(p['purpose']) != null) filter['purpose'] = p['purpose'];
    final max = int.tryParse(p['maxPrice'] ?? '');
    if (max != null && max > 0) filter['price.amount'] = {'$lte': max};
    final page = (int.tryParse(p['page'] ?? '1') ?? 1).clamp(1, 100000);
    final limit = (int.tryParse(p['limit'] ?? '24') ?? 24).clamp(1, 60);
    final docs = await listings.find(filter, limit: limit, skip: (page - 1) * limit, sort: {'createdAt': -1}).toList();
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
    final amount = rawPrice is num ? rawPrice.toInt() : int.tryParse('$rawPrice');
    if (title.length < 8 || description.length < 30 || district.isEmpty || type == null || purpose == null || amount == null || amount < 1) {
      return reply(422, {'error': 'Title must be 8+ characters, description 30+, and district, type, purpose and a positive RWF price are required.'});
    }
    final id = uid.v4(), createdAt = now();
    final record = <String, dynamic>{
      'publicId': id, 'ownerId': claims['sub'], 'title': title, 'description': description,
      'propertyType': type, 'purpose': purpose, 'location': {'district': district, 'sector': sector},
      'price': {'amount': amount, 'currency': 'RWF', 'period': purpose == 'rent' ? 'month' : 'once'},
      'status': 'pending_review', 'verification': {'status': 'unverified', 'checks': []},
      'createdAt': createdAt, 'updatedAt': createdAt,
    };
    final digest = sha256.convert(utf8.encode(jsonEncode(record))).toString();
    record['evidenceHash'] = digest;
    await listings.insertOne(record);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'listing.submitted', 'subjectId': id, 'actorId': claims['sub'], 'evidenceHash': digest, 'createdAt': createdAt});
    return reply(201, {'id': id, 'status': 'pending_review', 'evidenceHash': digest, 'message': 'Submitted for human review. It will not appear publicly until approved.'});
  });
  r.get('/api/v1/me/listings', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await listings.find(where.eq('ownerId', c['sub']), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
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
    return reply(200, {'id': id, 'status': status});
  });
  r.get('/api/v1/admin/listings/pending', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    if (c['role'] != 'admin') return reply(403, {'error': 'Administrator access required.'});
    final docs = await listings.find(where.eq('status', 'pending_review'), sort: {'createdAt': 1}).limit(100).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
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
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('status', 'published')));
    if (listing == null) return reply(404, {'error': 'Published property not found.'});
    if (listing['ownerId'] == c['sub']) return reply(422, {'error': 'You cannot create a buyer enquiry on your own listing.'});
    final item = {'publicId': uid.v4(), 'listingId': listingId, 'listingTitle': listing['title'], 'ownerId': listing['ownerId'], 'requesterId': c['sub'], 'type': type, 'message': message, 'preferredAt': preferredAt, 'status': 'open', 'createdAt': now()};
    await leads.insertOne(item);
    await audit.insertOne({'eventId': uid.v4(), 'type': 'lead.created', 'subjectId': item['publicId'], 'actorId': c['sub'], 'createdAt': now()});
    return reply(201, {'data': publicDoc(item)});
  });
  r.get('/api/v1/me/leads', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final all = await leads.find(where.or(where.eq('requesterId', c['sub']), where.eq('ownerId', c['sub'])), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': all.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });

  r.get('/api/v1/me/conversations', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await conversations.find(where.eq('participants', c['sub']), sort: {'updatedAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/conversations', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final b = await readJson(q, 20 * 1024);
    if (b == null) return reply(400, {'error': 'Send a valid JSON object.'});
    final listingId = clean(b['listingId'], 80);
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId).eq('status', 'published')));
    if (listing == null) return reply(404, {'error': 'Published property not found.'});
    final ownerId = listing['ownerId'];
    if (ownerId == c['sub']) return reply(422, {'error': 'You cannot start a conversation with yourself.'});
    final found = asMap(await conversations.findOne(where.eq('listingId', listingId).eq('participants', c['sub']).eq('ownerId', ownerId)));
    if (found != null) return reply(200, {'data': publicDoc(found)});
    final item = {'publicId': uid.v4(), 'listingId': listingId, 'listingTitle': listing['title'], 'ownerId': ownerId, 'participants': [c['sub'], ownerId], 'createdAt': now(), 'updatedAt': now()};
    await conversations.insertOne(item);
    return reply(201, {'data': publicDoc(item)});
  });
  r.get('/api/v1/conversations/<id>/messages', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final room = asMap(await conversations.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (room == null) return reply(404, {'error': 'Conversation not found.'});
    final docs = await messages.find(where.eq('conversationId', id), sort: {'createdAt': 1}).limit(300).toList();
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
    return reply(201, {'data': publicDoc(item)});
  });

  r.get('/api/v1/me/deals', (Request q) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final docs = await deals.find(where.eq('participants', c['sub']), sort: {'updatedAt': -1}).toList();
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
    if (item['stage'] == 'completed' || item['stage'] == 'cancelled') return reply(409, {'error': 'Closed deals cannot be advanced.'});
    final history = List<dynamic>.from(item['history'] as List? ?? []);
    history.add({'stage': stage, 'actorId': c['sub'], 'at': now(), 'note': clean(b?['note'], 500)});
    await deals.updateOne(where.eq('publicId', id), modify.set('stage', stage).set('updatedAt', now()).set('history', history));
    return reply(200, {'id': id, 'stage': stage, 'history': history});
  });
  r.post('/api/v1/deals/<id>/accept-fee', (Request q, String id) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final item = asMap(await deals.findOne(where.eq('publicId', id).eq('participants', c['sub'])));
    if (item == null) return reply(404, {'error': 'Deal not found.'});
    final accepted = List<dynamic>.from(item['feeAcceptedBy'] as List? ?? []);
    if (!accepted.contains(c['sub'])) accepted.add(c['sub']);
    await deals.updateOne(where.eq('publicId', id), modify.set('feeAcceptedBy', accepted).set('updatedAt', now()));
    return reply(200, {'id': id, 'feeAcceptedBy': accepted, 'fullyAccepted': accepted.length >= 2});
  });

  r.get('/api/v1/listings/<listingId>/documents', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId)));
    if (listing == null) return reply(404, {'error': 'Property not found.'});
    final isOwner = listing['ownerId'] == c['sub'];
    final inDeal = await deals.findOne(where.eq('listingId', listingId).eq('participants', c['sub'])) != null;
    if (!isOwner && !inDeal) return reply(403, {'error': 'Only the listing owner or a deal participant can view document metadata.'});
    final docs = await documents.find(where.eq('listingId', listingId), sort: {'createdAt': -1}).toList();
    return reply(200, {'data': docs.map((d) => publicDoc(Map<String, dynamic>.from(d))).toList()});
  });
  r.post('/api/v1/listings/<listingId>/documents', (Request q, String listingId) async {
    final c = await currentUser(q, users); if (c == null) return unauthenticated();
    final listing = asMap(await listings.findOne(where.eq('publicId', listingId)));
    if (listing == null) return reply(404, {'error': 'Property not found.'});
    if (listing['ownerId'] != c['sub']) return reply(403, {'error': 'Only the listing owner can upload evidence.'});
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
    final prefix = bytes.take(16).toList();
    final validMagic = mime == 'application/pdf' ? utf8.decode(prefix.take(4).toList(), allowMalformed: true) == '%PDF'
      : mime == 'image/jpeg' ? prefix.length >= 3 && prefix[0] == 255 && prefix[1] == 216 && prefix[2] == 255
      : mime == 'image/png' ? prefix.length >= 8 && prefix[0] == 137 && prefix[1] == 80 && prefix[2] == 78 && prefix[3] == 71
      : prefix.length >= 12 && prefix[0] == 82 && prefix[1] == 73 && prefix[2] == 70 && prefix[3] == 70 && prefix[8] == 87 && prefix[9] == 69 && prefix[10] == 66 && prefix[11] == 80;
    if (!validMagic) return reply(422, {'error': 'File signature does not match the selected file type.'});
    final id = uid.v4(), ext = allowed[mime]!;
    final directory = Directory(storageRoot); await directory.create(recursive: true);
    final path = storageRoot + Platform.pathSeparator + id + '.' + ext;
    await File(path).writeAsBytes(bytes, flush: true);
    final doc = {'publicId': id, 'listingId': listingId, 'uploadedBy': c['sub'], 'fileName': fileName, 'contentType': mime, 'sizeBytes': bytes.length, 'filePath': path, 'createdAt': now(), 'reviewStatus': 'not_reviewed'};
    await documents.insertOne(doc);
    final digest = sha256.convert(bytes).toString();
    await audit.insertOne({'eventId': uid.v4(), 'type': 'document.uploaded', 'subjectId': id, 'actorId': c['sub'], 'evidenceHash': digest, 'createdAt': now()});
    return reply(201, {'data': publicDoc(doc), 'sha256': digest, 'note': 'Stored privately. The digest proves a specific byte sequence was recorded, not that the document is genuine.'});
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
    if (req.method == 'OPTIONS') return Response(204, headers: {
      'access-control-allow-origin': webOrigin,
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Origin, Content-Type, Accept, Authorization',
      'access-control-max-age': '600',
      'vary': 'Origin',
    });
    final res = await inner(req);
    return res.change(headers: {
      'access-control-allow-origin': webOrigin,
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Origin, Content-Type, Accept, Authorization',
      'vary': 'Origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
    });
  }).addHandler(r.call);
  final server = await io.serve(handler, InternetAddress.anyIPv4, port);
  stdout.writeln('KOMISIYONERI API listening on ' + server.port.toString());
}
