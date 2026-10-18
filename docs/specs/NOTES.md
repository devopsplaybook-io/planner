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

[x] Labels: labels are free-form strings set at creation and in the note dialog edit mode via the chip editor with autocomplete from existing labels; they are saved through the labels replace API (`POST /api/notes/:id/labels`).

[x] Notes list: notes are displayed as cards showing the title, creation date, a description preview of up to 5 lines, labels and the comment count; cards have a minimum height so notes without a description remain readable and clickable.

[x] Notes list search and label filter: the notes page offers a debounced search input; the search term is sent as `q` to `GET /api/notes` and matched server-side as a case-insensitive substring over the note title and description; the search respects visibility and composes with the project filter (a selected project restricts the search to its whole subtree); while searching, the results replace the normal list and an empty result set shows a "No notes found" state. A label filter additionally selects one or more existing labels (autocomplete from the labels in use); only notes carrying every selected label are shown, and the label filter composes with both the search results and the project subtree filter.

[x] Advanced menu: the note dialog offers an advanced menu with Delete; delete is no longer a standalone button.

[x] Project change: when a note is opened in edit mode, the project can be changed; the target project must be visible to the user.

[x] Archived projects (see [PROJECTS.md](PROJECTS.md)) are read-only: notes in them cannot be created or updated (including comments, labels, attachments) and notes cannot be moved into them; deleting a note is still allowed.

## Visibility

- [x] Notes inherit the visibility of their project (see [PROJECTS.md](PROJECTS.md)): non-admin users can only list and see notes from public projects or restricted projects they are a member of; admins see all notes.
- [x] A note the user cannot see answers 404 on the note API, like a missing note.
- [x] Creating a note requires the target project to be visible to the user; updating, deleting and interacting with a note (comments, labels, attachments) requires the note to be visible to the user; changing the project requires the target project to be visible to the user.

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-10-18_
