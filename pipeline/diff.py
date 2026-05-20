"""Compare fetched RSS items against ``data/episodes/`` and write stubs.

W0 stub — implementation lands in W1. For every GUID in the feed that has no
corresponding ``data/episodes/{guid}.yaml`` or ``data/pending/{guid}.yaml``,
writes a new ``data/pending/{guid}.yaml`` with the RSS-derived fields
populated and the tagging fields left blank for human review.
"""
