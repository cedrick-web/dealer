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
    test('throttles repeated failed attempts and can be cleared on success', () {
      final key = 'unit-test-' + DateTime.now().microsecondsSinceEpoch.toString();
      expect(server.loginIsThrottled(key), isFalse);
      for (var i = 0; i < server.maxLoginFailures; i++) {
        server.recordLoginFailure(key);
      }
      expect(server.loginIsThrottled(key), isTrue);
      server.clearLoginFailures(key);
      expect(server.loginIsThrottled(key), isFalse);
    });

    test('bad password hashes fail closed', () {
      expect(server.passwordMatches('guess', 'not-a-bcrypt-hash'), isFalse);
      expect(server.passwordMatches('guess', null), isFalse);
    });
  });
}
