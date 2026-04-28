# API

## Base
`http://localhost:8000/api`

## Health
`GET /health`
Response: `{ "status": "ok", "checks": {...} }`

## Assets
**Upload**
```
POST /assets/upload
Content-Type: multipart/form-data
Body: file, name, owner_email
Response: { asset_id, name, created_at }
```

## Scans
**Start**
```
POST /scans/start
Body: { asset_id }
Response: { scan_id, status }
```

**Status**
```
GET /scans/{scan_id}
Response: { scan_id, status, matches_found, progress }
```

## Reports
**Get**
```
GET /reports/{scan_id}
Response: { scan_id, matches: [{ url, similarity, source }] }
```

## Errors
400 Bad request | 404 Not found | 500 Server error | 503 Service down