# Orders API Specification

## Base URL
`https://api.internal.acme.com/orders/v1`

## Authentication
All requests require a valid JWT in the `Authorization: Bearer <token>` header.
Tokens are issued by the Auth Service and must include the `orders:read` or
`orders:write` scope.

## Endpoints

### GET /orders
List orders with pagination.

**Query Parameters:**
| Parameter | Type   | Required | Default | Description              |
|-----------|--------|----------|---------|--------------------------|
| page      | int    | No       | 1       | Page number              |
| limit     | int    | No       | 20      | Items per page (max 100) |
| status    | string | No       | —       | Filter by status         |
| from      | string | No       | —       | ISO 8601 start date      |
| to        | string | No       | —       | ISO 8601 end date        |

**Response 200:**
```json
{
  "data": [
    {
      "id": "ord_abc123",
      "customerId": "cust_xyz",
      "status": "confirmed",
      "total": 149.99,
      "currency": "USD",
      "items": [
        {
          "sku": "WIDGET-001",
          "quantity": 2,
          "unitPrice": 74.99
        }
      ],
      "createdAt": "2025-01-15T10:30:00Z",
      "updatedAt": "2025-01-15T10:35:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 142
  }
}
```

### POST /orders
Create a new order.

**Request Body:**
```json
{
  "customerId": "cust_xyz",
  "items": [
    { "sku": "WIDGET-001", "quantity": 2 }
  ],
  "shippingAddress": {
    "line1": "123 Main St",
    "city": "Seattle",
    "state": "WA",
    "zip": "98101",
    "country": "US"
  }
}
```

**Response 201:** Returns the created order object.

**Error Codes:**
| Code | Description                    |
|------|--------------------------------|
| 400  | Invalid request body           |
| 401  | Missing or invalid auth token  |
| 403  | Insufficient scope             |
| 409  | Duplicate order (idempotency)  |
| 422  | Item out of stock              |
| 429  | Rate limit exceeded            |

### Rate Limits
- 100 requests per minute per API key
- 429 responses include `Retry-After` header
