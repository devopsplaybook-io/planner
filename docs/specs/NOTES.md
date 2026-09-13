# Notes

Notes are free-form text entries for capturing information. Each note belongs to
exactly one project and has the following attributes:

| Attribute       | Description                                      |
| --------------- | ------------------------------------------------ |
| [x] Title       | A short name for the note                        |
| [x] Description | The content of the note                          |
| [x] Comments    | Threaded comments on the note                    |
| [x] Attachments | Files attached to the note                       |
| [x] Labels      | Zero, one, or multiple labels for categorization |
| [x] Project     | The project the note belongs to (exactly one)    |

## Visibility

- [x] Notes inherit the visibility of their project (see [PROJECTS.md](PROJECTS.md)): non-admin users can only list and see notes from public projects or restricted projects they are a member of; admins see all notes.
- [x] A note the user cannot see answers 404 on the note API, like a missing note.
- [x] Creating a note requires the target project to be visible to the user; updating, deleting and interacting with a note (comments, labels, attachments) requires the note to be visible to the user.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-13_
