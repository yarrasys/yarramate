# D3 — revision history: updates preserve the replaced state, author-only.
# Author
POST {{host}}/api/users
{
  "user": {
    "username": "rev1_{{uid}}",
    "email": "rev1_{{uid}}@test.com",
    "password": "password123"
  }
}
HTTP 201
[Captures]
author: jsonpath "$.user.token"

POST {{host}}/api/articles
Authorization: Token {{author}}
{
  "article": {
    "title": "Revisions probe {{uid}}",
    "description": "d0",
    "body": "b0",
    "tagList": []
  }
}
HTTP 201
[Captures]
slug: jsonpath "$.article.slug"

# Never updated: zero revisions
GET {{host}}/api/articles/{{slug}}/revisions
Authorization: Token {{author}}
HTTP 200
[Asserts]
jsonpath "$.revisionCount" == 0
jsonpath "$.revisions" count == 0

# Two updates (title constant so the slug is stable)
PUT {{host}}/api/articles/{{slug}}
Authorization: Token {{author}}
{
  "article": {
    "description": "d1",
    "body": "b1"
  }
}
HTTP 200

PUT {{host}}/api/articles/{{slug}}
Authorization: Token {{author}}
{
  "article": {
    "body": "b2"
  }
}
HTTP 200

# Each revision is the replaced state, newest first: [v1, v0]
GET {{host}}/api/articles/{{slug}}/revisions
Authorization: Token {{author}}
HTTP 200
[Asserts]
jsonpath "$.revisionCount" == 2
jsonpath "$.revisions" count == 2
jsonpath "$.revisions[0].body" == "b1"
jsonpath "$.revisions[0].description" == "d1"
jsonpath "$.revisions[1].body" == "b0"
jsonpath "$.revisions[1].description" == "d0"
jsonpath "$.revisions[0].revisedAt" isString

# Authentication required
GET {{host}}/api/articles/{{slug}}/revisions
HTTP 401

# Author only
POST {{host}}/api/users
{
  "user": {
    "username": "rev2_{{uid}}",
    "email": "rev2_{{uid}}@test.com",
    "password": "password123"
  }
}
HTTP 201
[Captures]
other: jsonpath "$.user.token"

GET {{host}}/api/articles/{{slug}}/revisions
Authorization: Token {{other}}
HTTP 403
