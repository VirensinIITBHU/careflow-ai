"""Loads the screening policy. Swap policy/general_v0.yaml for a clinician-reviewed file later."""
from functools import lru_cache

import yaml

from .. import config


@lru_cache(maxsize=1)
def load() -> dict:
    with open(config.POLICY_PATH, encoding="utf-8") as fh:
        policy = yaml.safe_load(fh)
    assert policy.get("version") and policy.get("categories"), "policy needs version and categories"
    for cat in policy["categories"]:
        assert {"id", "tier", "title", "rationale", "terms"} <= set(cat), f"incomplete category {cat.get('id')}"
        assert cat["tier"] in ("immediate", "urgent", "standard"), f"bad tier in {cat['id']}"
        for rule in cat.get("near", []):
            cid = cat["id"]
            assert isinstance(rule.get("a"), list) and rule["a"] and all(isinstance(x, str) and x for x in rule["a"]), f"bad near.a in {cid}"
            assert isinstance(rule.get("b"), list) and rule["b"] and all(isinstance(x, str) and x for x in rule["b"]), f"bad near.b in {cid}"
            assert "max_gap" not in rule or (type(rule["max_gap"]) is int and 0 <= rule["max_gap"] <= 8), f"bad near.max_gap in {cid}"
            assert "exclude" not in rule or (isinstance(rule["exclude"], list) and all(isinstance(x, str) for x in rule["exclude"])), f"bad near.exclude in {cid}"
    return policy
