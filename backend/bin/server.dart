import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:mongo_dart/mongo_dart.dart';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as io;
import 'package:shelf_router/shelf_router.dart';
import 'package:uuid/uuid.dart';

final uid = const Uuid();
Response jsonResponse(int status, Object body) => Response(status, body: jsonEncode(body), headers: {'content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff'});
String clean(dynamic value, [int max=3000]) { if (value is! String) return ''; final s=value.trim(); return s.substring(0, s.length > max ? max : s.length); }
Future<void> main() async {
  final port=int.tryParse(Platform.environment['API_PORT'] ?? '8080') ?? 8080;
  final uri=Platform.environment['MONGO_URI'];
  Db? db; DbCollection? listings; DbCollection? audit;
  if (uri != null && uri.isNotEmpty) { db=await Db.create(uri); await db.open(); listings=db.collection('listings'); audit=db.collection('audit_events'); }
  final r=Router();
  r.get('/health', (Request q) => jsonResponse(200, {'status':'ok','service':'komisiyoneri-api','database':db == null ? 'not configured' : 'connected'}));
  r.get('/api/v1/districts', (Request q) => jsonResponse(200, {'data':['Gasabo','Kicukiro','Nyarugenge','Bugesera','Rwamagana','Kamonyi','Musanze','Rubavu','Huye','Muhanga','Rulindo','Nyagatare','Rusizi']}));
  r.get('/api/v1/listings', (Request q) async {
    if (listings == null) return jsonResponse(503, {'error':'Database unavailable'});
    final p=q.url.queryParameters; final filter=<String,dynamic>{'status':'published'};
    if ((p['district'] ?? '').isNotEmpty) filter['location.district']=p['district'];
    if ((p['type'] ?? '').isNotEmpty) filter['propertyType']=p['type'];
    if ((p['purpose'] ?? '').isNotEmpty) filter['purpose']=p['purpose'];
    final max=int.tryParse(p['maxPrice'] ?? '');
    if (max != null && max > 0) filter['price.amount']={'$lte':max};
    final limit=(int.tryParse(p['limit'] ?? '24') ?? 24).clamp(1,60);
    final docs=await listings.find(filter, limit:limit, sort:{'createdAt':-1}).toList();
    return jsonResponse(200, {'data':docs.map((d){final x=Map<String,dynamic>.from(d); x.remove('_id'); x.remove('evidenceHash'); x.remove('ownerPrivate'); return x;}).toList()});
  });
  r.post('/api/v1/listings', (Request q) async {
    if (listings == null || audit == null) return jsonResponse(503, {'error':'Database unavailable'});
    Map<String,dynamic> b;
    try { final v=jsonDecode(await q.readAsString()); if (v is! Map<String,dynamic>) return jsonResponse(400, {'error':'Expected JSON object'}); b=v; }
    catch (_) { return jsonResponse(400, {'error':'Invalid JSON'}); }
    final title=clean(b['title'],120), description=clean(b['description']);
    final loc=b['location'] is Map ? b['location'] as Map : {};
    final district=clean(loc['district'],60), type=clean(b['propertyType'],30), purpose=clean(b['purpose'],20);
    final price=b['price'] is Map ? (b['price'] as Map)['amount'] : null;
    final amount=price is num ? price.toInt() : int.tryParse('$price');
    if (title.length<8 || description.length<30 || district.isEmpty || !['house','apartment','land','commercial','room'].contains(type) || !['sale','rent'].contains(purpose) || amount==null || amount<1) return jsonResponse(422, {'error':'Provide valid title, detailed description, property type, purpose, district and positive RWF price.'});
    final now=DateTime.now().toUtc().toIso8601String(), id=uid.v4();
    final record=<String,dynamic>{'publicId':id,'title':title,'description':description,'propertyType':type,'purpose':purpose,'location':{'district':district,'sector':clean(loc['sector'],80)},'price':{'amount':amount,'currency':'RWF','period':purpose=='rent'?'month':'once'},'status':'pending_review','verification':{'status':'unverified'},'createdAt':now};
    final digest=sha256.convert(utf8.encode(jsonEncode(record))).toString(); record['evidenceHash']=digest;
    await listings.insertOne(record);
    await audit.insertOne({'eventId':uid.v4(),'type':'listing.submitted','subjectId':id,'evidenceHash':digest,'createdAt':now});
    return jsonResponse(201, {'id':id,'status':'pending_review','message':'Submitted for human review; not publicly visible until approved.'});
  });
  r.get('/api/v1/trust/verify/<hash>', (Request q,String hash) async {
    if(audit==null) return jsonResponse(503, {'error':'Database unavailable'});
    final found=await audit.findOne(where.eq('evidenceHash',hash));
    return jsonResponse(200, {'exists':found!=null,'meaning':'A matching digest was logged. This does not prove ownership or document authenticity.'});
  });
  final handler=Pipeline().addMiddleware(logRequests()).addMiddleware((inner) => (req) async {
    if(req.method=='OPTIONS') return Response(204,headers:{'access-control-allow-origin':'http://localhost:5173','access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Origin, Content-Type, Accept, Authorization'});
    final res=await inner(req);
    return res.change(headers:{'access-control-allow-origin':'http://localhost:5173','x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer'});
  }).addHandler(r.call);
  final server=await io.serve(handler,InternetAddress.anyIPv4,port);
  stdout.writeln('KOMISIYONERI API listening on ${server.port}');
}
