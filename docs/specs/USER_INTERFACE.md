# User Interface

The web interface is a **Progressive Web Application (PWA)**.
It is installable on mobile and desktop devices and works offline.

## Characteristics

- [x] **Responsive**: Adapts to all screen sizes from mobile to desktop
- [x] **PWA**: Installable with offline support, configured via @vite-pwa/nuxt

## Navigation

- [x] There is a **left side menu** to switch between views
- [x] On mobile, the menu auto-collapses to save screen space
- [x] The menu provides access to: Projects, Tasks, Notes, Calendar, Kanban, and Settings
- [x] Offline support (PWA configured with service worker, cache strategies)

### Project Selection

- [x] The user interface saves the selected project in the local storage and automatically keep this project selected. It should remember this across the entire UI for all task view: Tasks, Calender, Tasks

## Components

### Shared

- [x] Tasks, Projects and Notes must have a consistent way to be displayed and edited. While they may be represented by different components, their look and feel must be similar.
  - [x] When listing, they are represented as a card with the key information
  - [x] Clicking on a card will display the detail. Some basic information can be updated there
  - [x] When the detail is closed, the user is sent back to the previous page. If the previous page is not in the application, the user is sent to the page most related to the object
  - [x] From the detail a full edit mode can be triggered with more editing features
  - [x] When a Task, Note or Project is displayed, the URL reflects the object that is displayed and this URL can be shared and reused later or for other users to open the same object

### Tasks

- [x] A component must be created to represent a task. This component should display consistently all the main properties and actions on a task. This component must be used in all views
  - [x] A Task Card: summary card displayed in all views
  - [x] A Task Detail: a dialog that displays the full task once the card is clicked

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-06-11_
