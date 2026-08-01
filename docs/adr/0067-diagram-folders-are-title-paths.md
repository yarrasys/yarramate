# Diagram folders are title paths

Status: accepted

Organizing the repository's 21 views into five ordered stories (PR
#130) fixed the table of contents in the project document — but only
there. The generated LikeC4 project still presented every view in one
flat root list, because the story structure lived in YAML comments the
exporter cannot see.

LikeC4 1.59 groups views without any dedicated grammar: a view title
containing `/` separators is a path, every segment but the last is a
sidebar folder, and the last segment is the displayed title. So the
grouping construct we need already exists, and it is a plain string.

Decided:

- The project definition gains an optional `folder` per view. It is
  presentation data of the *diagram project*, not of the projection —
  the same projection may sit in different folders in different
  projects, and markdown or graph exports of it are untouched.
- The exporter emits the folder as a title path: `title 'Folder /
  Title'`. Nesting is `/` inside the folder value. A view whose
  projection declares no presentation title still gets a title line,
  with the view id as the leaf — a folder assignment must never be
  silently dropped.
- Folder names carry their own order. LikeC4 sorts sibling folders by
  name (natural compare on the path), so a deliberate reading order is
  encoded where it belongs, in the name: `"1 · Orientation"`, `"2 ·
  Agent contract"`. Views inside a folder keep the views-list order,
  so the project document remains the table of contents.
- The synthetic `review-changes` view (ADR 0066) stays at the root: it
  is the view a reviewer opens first, not part of any story.

Zero new LikeC4 constructs, continuing ADR 0066's discipline: the
generated model validates against the same grammar as before, and a
consumer on an older LikeC4 simply sees the path as a longer title.
