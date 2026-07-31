# D2 — audit log: successful mutations recorded, caller sees only their own.
# Unauthenticated access is rejected
GET {{host}}/api/audit
HTTP 401

# First user
POST {{host}}/api/users
{
  "user": {
    "username": "audit1_{{uid}}",
    "email": "audit1_{{uid}}@test.com",
    "password": "password123"
  }
}
HTTP 201
[Captures]
token1: jsonpath "$.user.token"

# Three audited mutations: create, update, favorite
POST {{host}}/api/articles
Authorization: Token {{token1}}
{
  "article": {
    "title": "Audit probe {{uid}}",
    "description": "probe",
    "body": "v0",
    "tagList": []
  }
}
HTTP 201
[Captures]
slug: jsonpath "$.article.slug"

PUT {{host}}/api/articles/{{slug}}
Authorization: Token {{token1}}
{
  "article": {
    "body": "v1"
  }
}
HTTP 200

POST {{host}}/api/articles/{{slug}}/favorite
Authorization: Token {{token1}}
HTTP 200

# Newest first, actions and resources literal per the delta table
GET {{host}}/api/audit
Authorization: Token {{token1}}
HTTP 200
[Asserts]
jsonpath "$.auditCount" == 3
jsonpath "$.audit" count == 3
jsonpath "$.audit[0].action" == "favorite"
jsonpath "$.audit[0].resourceType" == "article"
jsonpath "$.audit[0].resourceId" == "{{slug}}"
jsonpath "$.audit[1].action" == "update"
jsonpath "$.audit[2].action" == "create"
jsonpath "$.audit[0].createdAt" isString

# Pagination: limit narrows the page, not the count
GET {{host}}/api/audit?limit=1
Authorization: Token {{token1}}
HTTP 200
[Asserts]
jsonpath "$.audit" count == 1
jsonpath "$.auditCount" == 3
jsonpath "$.audit[0].action" == "favorite"

# Second user's action lands in their log, not the first user's
POST {{host}}/api/users
{
  "user": {
    "username": "audit2_{{uid}}",
    "email": "audit2_{{uid}}@test.com",
    "password": "password123"
  }
}
HTTP 201
[Captures]
token2: jsonpath "$.user.token"

POST {{host}}/api/articles/{{slug}}/favorite
Authorization: Token {{token2}}
HTTP 200

GET {{host}}/api/audit
Authorization: Token {{token2}}
HTTP 200
[Asserts]
jsonpath "$.auditCount" == 1
jsonpath "$.audit[0].action" == "favorite"

GET {{host}}/api/audit
Authorization: Token {{token1}}
HTTP 200
[Asserts]
jsonpath "$.auditCount" == 3
