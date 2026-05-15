"""
CloudWatch metrics emitter for the LangChain MCP server.

Publishes to the Kiro/BedrockKB namespace so metrics feed the same
CloudWatch dashboard and alarms deployed by the CDK monitoring stack.
"""

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Optional

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

NAMESPACE = "Kiro/BedrockKB"


class MetricsEmitter:
    """Buffers and publishes CloudWatch custom metrics."""

    def __init__(self, region: str):
        self.client = boto3.client("cloudwatch", region_name=region)
        self._buffer: list[dict] = []
        self._lock = threading.Lock()
        self._running = True
        self._flush_thread = threading.Thread(
            target=self._flush_loop, daemon=True
        )
        self._flush_thread.start()

    def record_retrieval(self, latency_ms: float, result_count: int) -> None:
        """Record a successful retrieval with its latency."""
        now = datetime.now(timezone.utc)
        with self._lock:
            self._buffer.extend(
                [
                    {
                        "MetricName": "RetrievalLatency",
                        "Value": latency_ms,
                        "Unit": "Milliseconds",
                        "Timestamp": now,
                    },
                    {
                        "MetricName": "QueryCount",
                        "Value": 1,
                        "Unit": "Count",
                        "Timestamp": now,
                    },
                ]
            )
            if result_count == 0:
                self._buffer.append(
                    {
                        "MetricName": "EmptyResults",
                        "Value": 1,
                        "Unit": "Count",
                        "Timestamp": now,
                    }
                )

    def record_error(self) -> None:
        """Record a retrieval error."""
        with self._lock:
            self._buffer.append(
                {
                    "MetricName": "RetrievalErrors",
                    "Value": 1,
                    "Unit": "Count",
                    "Timestamp": datetime.now(timezone.utc),
                }
            )

    def record_productivity_event(self, query_type: str) -> None:
        """Record a productivity signal by query type."""
        with self._lock:
            self._buffer.append(
                {
                    "MetricName": "ProductivityQueries",
                    "Value": 1,
                    "Unit": "Count",
                    "Timestamp": datetime.now(timezone.utc),
                    "Dimensions": [
                        {"Name": "QueryType", "Value": query_type},
                    ],
                }
            )

    def flush(self) -> None:
        """Flush buffered metrics to CloudWatch."""
        with self._lock:
            if not self._buffer:
                return
            batch = self._buffer[:20]  # CW limit: 20 per call
            self._buffer = self._buffer[20:]

        try:
            self.client.put_metric_data(
                Namespace=NAMESPACE, MetricData=batch
            )
        except ClientError as e:
            logger.error("Failed to publish metrics: %s", e)
            # Put them back for retry
            with self._lock:
                self._buffer = batch + self._buffer

    def _flush_loop(self) -> None:
        """Background thread that flushes every 30 seconds."""
        while self._running:
            time.sleep(30)
            self.flush()

    def stop(self) -> None:
        """Clean shutdown — flush remaining metrics."""
        self._running = False
        self.flush()
