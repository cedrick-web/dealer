import 'package:shelf/shelf.dart';
import 'package:test/test.dart';

import '../bin/server.dart' as server;

void main() {
  group('input helpers', () {
    test('clean trims and caps untrusted text', () {
      expect(server.clean('  address value  '), 'address value');
      expect(server.clean('  address value  ', 4), 'addr');
      expect(server.clean(null), '');
      expect(server.clean(123), '');
    });

    test('file signature checks reject mismatched and truncated uploads', () {
      expect(server.hasAllowedFileSignature('application/pdf', [37, 80, 68, 70]), isTrue);
      expect(server.hasAllowedFileSignature('application/pdf', [37, 80, 68]), isFalse);
      expect(server.hasAllowedFileSignature('image/jpeg', [255, 216, 255, 0]), isTrue);
      expect(server.hasAllowedFileSignature('image/png', [137, 80, 78, 71, 13, 10, 26, 10]), isTrue);
      expect(server.hasAllowedFileSignature('image/png', [137, 80, 78, 71, 0, 0, 0, 0]), isFalse);
      expect(server.hasAllowedFileSignature('image/webp', [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), isTrue);
      expect(server.hasAllowedFileSignature('image/svg+xml', [60, 115, 118, 103]), isFalse);
    });

    test('JSON parser rejects oversized bodies and accepts valid JSON', () async {
      final chunkedLarge = Request(
        'POST',
        Uri.parse('http://localhost/api/test'),
        body: '{"description":"this body is deliberately too long"}',
      );
      expect(await server.readJson(chunkedLarge, 12), isNull);

      final valid = Request(
        'POST',
        Uri.parse('http://localhost/api/test'),
        body: '{"ok":true}',
      );
      expect(await server.readJson(valid, 30), {'ok': true});
    });

    test('listing category validators allow only supported values', () {
      expect(server.validType('house'), 'house');
      expect(server.validType('land'), 'land');
      expect(server.validType('vehicle'), isNull);
      expect(server.validPurpose('sale'), 'sale');
      expect(server.validPurpose('rent'), 'rent');
      expect(server.validPurpose('anything'), isNull);
    });
  });

  group('bearer token validation', () {
    test('accepts a correctly signed token before expiry', () {
      final token = server.issueToken({
        'sub': 'user-test',
        'email': 'user@example.com',
        'role': 'member',
        'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60,
      });
      final request = Request(
        'GET',
        Uri.parse('http://localhost/api/v1/auth/me'),
        headers: {'authorization': 'Bearer $token'},
      );

      expect(server.userFrom(request)?['sub'], 'user-test');
    });

    test('rejects a token exactly at its expiry second', () {
      final token = server.issueToken({
        'sub': 'boundary-user',
        'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000,
      });
      final request = Request(
        'GET',
        Uri.parse('http://localhost/api/v1/auth/me'),
        headers: {'authorization': 'Bearer $token'},
      );

      expect(server.userFrom(request), isNull);
    });

    test('rejects an expired token', () {
      final token = server.issueToken({
        'sub': 'expired-user',
        'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 - 10,
      });
      final request = Request(
        'GET',
        Uri.parse('http://localhost/api/v1/auth/me'),
        headers: {'authorization': 'Bearer $token'},
      );

      expect(server.userFrom(request), isNull);
    });

    test('rejects a token whose signature was modified', () {
      final token = server.issueToken({
        'sub': 'tampered-user',
        'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 60,
      });
      final payload = token.split('.').first;
      final altered = payload + '.' + List<String>.filled(64, 'x').join();
      final request = Request(
        'GET',
        Uri.parse('http://localhost/api/v1/auth/me'),
        headers: {'authorization': 'Bearer $altered'},
      );

      expect(server.userFrom(request), isNull);
    });
  });

  group('sign-in protection', () {
    test('shared login throttle uses the documented attempt limit and window', () {
      expect(server.maxLoginFailures, 8);
      expect(server.loginFailureWindow, const Duration(minutes: 15));
    });

    test('bad password hashes fail closed', () {
      expect(server.passwordMatches('guess', 'not-a-bcrypt-hash'), isFalse);
      expect(server.passwordMatches('guess', null), isFalse);
    });
  });
}
