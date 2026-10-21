import unittest

from app import audit, db
from tests.helpers import fresh_db


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = fresh_db()

    def tearDown(self):
        self.tmp.cleanup()

    def test_chain_detects_tampering(self):
        with db.tx() as c:
            for i in range(3):
                audit.append(c, "u", "reviewer", "act", "CF-1", {"i": i})
        c = db.connect()
        self.assertEqual(audit.verify(c), {"ok": True, "checked": 3, "broken_at_seq": None})
        c.execute("UPDATE audit SET details='{\"i\": 99}' WHERE seq=2")
        c.commit()
        self.assertEqual(audit.verify(c)["broken_at_seq"], 2)
        c.close()


if __name__ == "__main__":
    unittest.main()
