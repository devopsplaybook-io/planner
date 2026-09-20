# Notes

Notes are free-form text entries for capturing information. Each note belongs to
exactly one project and has the following attributes:

| Attribute       | Description                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| [x] Title       | A short name for the note                                                   |
| [x] Description | The content of the note                                                     |
| [x] Comments    | Flat comments on the note, with markdown rendering, edit and delete         |
| [x] Attachments | Files attached to the note                                                  |
| [x] Labels      | Zero, one, or multiple labels for categorization                            |
| [x] Project     | The project the note belongs to (exactly one)                               |

## Management of Notes

[x] Create: after creating a note, the note dialog opens on the new object.

[x] Update: when a note is clicked, the note is displayed and the user can edit the note.

[x] Notes list: notes are displayed as cards showing the title, creation date, a description preview of up to 5 lines, labels and the comment count; cards have a minimum height so notes without a description remain readable and clickable.

[x] Advanced menu: the note dialog offers an advanced menu with Delete; delete is no longer a standalone button.

[x] Project change: when a note is opened in edit mode, the project can be changed; the target project must be visible to the user.

[x] Archived projects (see [PROJECTS.md](PROJECTS.md)) are read-only: notes in them cannot be created or updated (including comments, labels, attachments) and notes cannot be moved into them; deleting a note is still allowed.

## Visibility

- [x] Notes inherit the visibility of their project (see [PROJECTS.md](PROJECTS.md)): non-admin users can only list and see notes from public projects or restricted projects they are a member of; admins see all notes.
- [x] A note the user cannot see answers 404 on the note API, like a missing note.
- [x] Creating a note requires the target project to be visible to the user; updating, deleting and interacting with a note (comments, labels, attachments) requires the note to be visible to the user; changing the project requires the target project to be visible to the user.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-09-18_
