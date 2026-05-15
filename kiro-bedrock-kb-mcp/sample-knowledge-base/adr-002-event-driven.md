# ADR-002: Event-Driven Architecture for Order Processing

## Status
Accepted

## Context
The order processing pipeline involves 6 services (inventory, payment,
shipping, notifications, analytics, fraud detection). Synchronous HTTP
calls create tight coupling and make it difficult to add new consumers.

## Decision
Adopt an event-driven architecture using Amazon EventBridge for
inter-service communication in the order processing domain.

### Event Schema
All events follow the CloudEvents specification:

```json
{
  "source": "orders-service",
  "type": "order.created",
  "specversion": "1.0",
  "id": "evt_abc123",
  "time": "2025-01-15T10:30:00Z",
  "data": {
    "orderId": "ord_abc123",
    "customerId": "cust_xyz",
    "total": 149.99,
    "items": [{ "sku": "WIDGET-001", "quantity": 2 }]
  }
}
```

### Event Types
| Event                | Producer        | Consumers                          |
|----------------------|-----------------|------------------------------------|
| order.created        | Orders Service  | Inventory, Payment, Fraud, Analytics |
| order.paid           | Payment Service | Shipping, Notifications            |
| order.shipped        | Shipping Service| Notifications, Analytics           |
| order.cancelled      | Orders Service  | Inventory, Payment, Notifications  |
| inventory.reserved   | Inventory       | Orders Service                     |
| fraud.flagged        | Fraud Detection | Orders Service, Notifications      |

### Implementation

```typescript
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";

const eventBridge = new EventBridgeClient({ region: "us-east-1" });

async function publishOrderCreated(order: Order): Promise<void> {
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: "orders-service",
      DetailType: "order.created",
      Detail: JSON.stringify({
        orderId: order.id,
        customerId: order.customerId,
        total: order.total,
        items: order.items,
      }),
      EventBusName: "acme-orders",
    }],
  }));
}
```

## Consequences
- Services are decoupled; adding new consumers requires no producer changes
- Eventual consistency: order state may lag by 1-2 seconds
- Requires idempotent event handlers (use `eventId` for deduplication)
- Dead letter queues needed for failed event processing
