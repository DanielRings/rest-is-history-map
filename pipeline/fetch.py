"""Fetch and parse the Supporting Cast RSS feed into raw episode records.

W0 stub — implementation lands in W1. Reads the feed URL from the
``RIH_RSS_URL`` environment variable. No network access in tests; W1's tests
parse ``data/samples/rss.sample.xml`` directly.
"""
