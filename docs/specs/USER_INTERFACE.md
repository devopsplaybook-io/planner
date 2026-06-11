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

## Components

- [x] A component must be created to represent a task. This component should display consistently all the main properties and actions on a task. This component must be used in all the views
  - [x] A Task Card: summary card displayed in all view
  - [x] A Task Detail: a dialog that display the full task once the card is clicked

_Implementation: [x]=Done [~]=Partial [ ]=Not Started | Last spec review: 2026-06-11_
