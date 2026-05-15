# ADR-001: Circuit Breaker Pattern for Service Communication

## Status
Accepted

## Context
Our microservices architecture has 15+ services communicating over HTTP.
Cascading failures have caused two P1 incidents in the past quarter when
downstream services became unresponsive.

## Decision
Adopt the Circuit Breaker pattern for all inter-service HTTP calls using
a shared library wrapper around our HTTP client.

### Configuration Defaults
| Parameter          | Value  | Rationale                          |
|--------------------|--------|------------------------------------|
| Failure threshold  | 5      | Trips after 5 consecutive failures |
| Reset timeout      | 30s    | Half-open after 30 seconds         |
| Success threshold  | 3      | Closes after 3 successful calls    |
| Request timeout    | 5s     | Per-request timeout                |

### Implementation

```typescript
import { CircuitBreaker } from "@acme/resilience";

const breaker = new CircuitBreaker({
  failureThreshold: 5,
  resetTimeout: 30_000,
  successThreshold: 3,
  requestTimeout: 5_000,
  onStateChange: (from, to) => {
    metrics.emit("circuit_breaker.state_change", { from, to, service: "orders" });
  },
});

// Usage
const response = await breaker.execute(() =>
  httpClient.get("https://orders-service.internal/api/v1/orders")
);
```

### Fallback Strategy
When the circuit is open, services must return a degraded response:
- **Read operations**: Return cached data with a `X-Degraded: true` header
- **Write operations**: Queue to SQS for retry, return 202 Accepted

## Consequences
- Prevents cascading failures across the service mesh
- Adds ~2ms latency overhead per request for state checking
- Requires CloudWatch alarms on circuit state changes
- Teams must implement fallback handlers for each endpoint
