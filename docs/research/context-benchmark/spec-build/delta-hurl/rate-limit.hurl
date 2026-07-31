# D1 — per-user rate limit on mutations: 60 per rolling 60s, then 429.
# Register (unauthenticated: exempt from the limit)
POST {{host}}/api/users
{
  "user": {
    "username": "rl_{{uid}}",
    "email": "rl_{{uid}}@test.com",
    "password": "password123"
  }
}
HTTP 201
[Captures]
token: jsonpath "$.user.token"

# Mutation 1 of 60: create an article to favorite
POST {{host}}/api/articles
Authorization: Token {{token}}
{
  "article": {
    "title": "Rate limit probe {{uid}}",
    "description": "probe",
    "body": "probe",
    "tagList": []
  }
}
HTTP 201
[Captures]
slug: jsonpath "$.article.slug"

# Mutations 2..60: 59 favorites, all inside the limit, all succeed
POST {{host}}/api/articles/{{slug}}/favorite
Authorization: Token {{token}}
[Options]
repeat: 59
HTTP 200

# Mutation 61 inside the window: rejected with the standard envelope
DELETE {{host}}/api/articles/{{slug}}/favorite
Authorization: Token {{token}}
HTTP 429
[Asserts]
jsonpath "$.errors['rate-limit']" count == 1
jsonpath "$.errors['rate-limit'][0]" == "too many mutating requests"

# GET requests are never limited
GET {{host}}/api/articles/{{slug}}
Authorization: Token {{token}}
HTTP 200
[Asserts]
jsonpath "$.article.slug" == "{{slug}}"
