import { BrushType } from '../../utils/Brush';
import type { ShapeType } from '../../utils/shapes';

// ===================== SVG 图标库 =====================
const RAW_ICONS: Record<string, string> = {
  back:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M19 12H5M12 19l-7-7 7-7"/%3E%3C/svg%3E',
  undo:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="1 4 1 10 7 10"/%3E%3Cpath d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/%3E%3C/svg%3E',
  redo:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="23 4 23 10 17 10"/%3E%3Cpath d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/%3E%3C/svg%3E',
  layers:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolygon points="12 2 22 8.5 12 15 2 8.5 12 2"/%3E%3Cpolyline points="2 15.5 12 22 22 15.5"/%3E%3C/svg%3E',
  close:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Cline x1="18" y1="6" x2="6" y2="18"/%3E%3Cline x1="6" y1="6" x2="18" y2="18"/%3E%3C/svg%3E',
  pencil:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/%3E%3C/svg%3E',
  marker:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m12 19 7-7 3 3-7 7-3-3z"/%3E%3Cpath d="m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/%3E%3Cpath d="m2 2 7.586 7.586"/%3E%3Ccircle cx="11" cy="11" r="2"/%3E%3C/svg%3E',
  highlighter: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m9 11-6 6v3h9l3-3"/%3E%3Cpath d="m22 12-4-4-4 4 4 4 4-4z"/%3E%3Cpath d="M14 10V3l-4 4h1"/%3E%3C/svg%3E',
  eraser:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10.4-10.4a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19"/%3E%3Cpath d="M7 21h8"/%3E%3Cpath d="M17 13.8V21"/%3E%3C/svg%3E',
  palette:  '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="13.5" cy="6.5" r="2"/%3E%3Ccircle cx="17.5" cy="10.5" r="2"/%3E%3Ccircle cx="8.5" cy="7.5" r="2"/%3E%3Ccircle cx="6.5" cy="12.5" r="2"/%3E%3Cpath d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-1 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.5-4.5-10-10-10z"/%3E%3C/svg%3E',
  image:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2" ry="2"/%3E%3Ccircle cx="8.5" cy="8.5" r="1.5"/%3E%3Cpolyline points="21 15 16 10 5 21"/%3E%3C/svg%3E',
  trash:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolyline points="3 6 5 6 21 6"/%3E%3Cpath d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/%3E%3Cpath d="M10 11v6"/%3E%3Cpath d="M14 11v6"/%3E%3Cpath d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/%3E%3C/svg%3E',
  download: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/%3E%3Cpolyline points="7 10 12 15 17 10"/%3E%3Cline x1="12" y1="15" x2="12" y2="3"/%3E%3C/svg%3E',
  eyedropper: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="m2 22 1-1h3l9-9"/%3E%3Cpath d="M3 21 12 12"/%3E%3Cpath d="M13.5 3.5a2.12 2.12 0 0 1 3 3L11 13l-4 1 1-4 5.5-5.5z"/%3E%3C/svg%3E',
  plus:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Cline x1="12" y1="5" x2="12" y2="19"/%3E%3Cline x1="5" y1="12" x2="19" y2="12"/%3E%3C/svg%3E',
  eye:      '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3C/svg%3E',
  eyeOff:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/%3E%3Cpath d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/%3E%3Cpath d="m14.12 14.12a3 3 0 1 1-4.24-4.24"/%3E%3Cline x1="1" y1="1" x2="23" y2="23"/%3E%3C/svg%3E',
  merge:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Cpath d="M8 6h10"/%3E%3Cpath d="M6 12h12"/%3E%3Cpath d="M8 18h8"/%3E%3C/svg%3E',
  size:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"%3E%3Ccircle cx="12" cy="12" r="2"/%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3C/svg%3E',
  gear:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3Cpath d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/%3E%3C/svg%3E',
  tool:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/%3E%3C/svg%3E',
  // 预设图形
  shape:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="7" height="7"/%3E%3Ccircle cx="17.5" cy="6.5" r="3.5"/%3E%3Cpolygon points="12 21 5 8 19 8"/%3E%3C/svg%3E',
  // AI 玩法
  ai:       '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/%3E%3Cpath d="M18 18l.5 2L20 20.5l-1.5.5-.5 2-.5-2L16 20.5l1.5-.5z"/%3E%3C/svg%3E',

  // 重置视角
  reset:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 16"/%3E%3Cpath d="M3 22v-6h6"/%3E%3C/svg%3E',

  // ==== 素材库图标 ====
  mat_circle:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="12" r="9"/%3E%3C/svg%3E',
  mat_rect:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="4" width="18" height="16" rx="2"/%3E%3C/svg%3E',
  mat_triangle: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/%3E%3C/svg%3E',
  mat_star:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpolygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/%3E%3C/svg%3E',
  mat_heart:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/%3E%3C/svg%3E',
  mat_smile:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M8 14s1.5 2 4 2 4-2 4-2"/%3E%3Cline x1="9" y1="9" x2="9.01" y2="9"/%3E%3Cline x1="15" y1="9" x2="15.01" y2="9"/%3E%3C/svg%3E',
  mat_flower:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="12" r="3"/%3E%3Cpath d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/%3E%3C/svg%3E',
  mat_sparkle:  '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/%3E%3C/svg%3E',
  mat_fire:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/%3E%3C/svg%3E',
  mat_rainbow:  '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round"%3E%3Cpath d="M2 12C2 6.48 6.48 2 12 2s10 4.48 10 10"/%3E%3Cpath d="M2 12a10 10 0 0 1 10-10" stroke="%23EF4444" stroke-width="2" fill="none"/%3E%3Cpath d="M5 12a7 7 0 0 1 7-7" stroke="%23F59E0B" stroke-width="2" fill="none"/%3E%3Cpath d="M8 12a4 4 0 0 1 4-4" stroke="%2310B981" stroke-width="2" fill="none"/%3E%3Cpath d="M11 12a1 1 0 0 1 1-1" stroke="%233B82F6" stroke-width="2" fill="none"/%3E%3C/svg%3E',
  mat_moon:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/%3E%3C/svg%3E',
  mat_cat:      '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M12 5c.67 0 1.35.09 2 .26 1.78-2 5.03-2.84 6.42-2.26 2.01.84-.5 5.15-1.4 6.62.37.98.58 2.04.58 3.38 0 4.41-3.13 8-7 8s-7-3.59-7-8c0-1.34.21-2.4.58-3.38-.9-1.47-3.41-5.78-1.4-6.62 1.39-.58 4.64.26 6.42 2.26.65-.17 1.33-.26 2-.26z"/%3E%3Cpath d="M8 14s1.5 2 4 2 4-2 4-2"/%3E%3Cline x1="9" y1="9" x2="9.01" y2="9"/%3E%3Cline x1="15" y1="9" x2="15.01" y2="9"/%3E%3C/svg%3E',
  mat_dog:      '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M10 5.17C10.68 5.06 11.35 5 12 5c.66 0 1.32.06 2 .17M16 3c-1.56.56-3.2.75-4 .83-1.6-.08-3.24-.27-4-.83M8.5 14.5 5 22M15.5 14.5 19 22"/%3E%3Cpath d="M8 8.5c0 1.5 1 3 4 3s4-1.5 4-3M5 14c-1.5-.5-2-1.5-2-3 0-1.5 1-2 2-2.5M19 14c1.5-.5 2-1.5 2-3 0-1.5-1-2-2-2.5M8 11l-.5-3M16 11l.5-3"/%3E%3Ccircle cx="9.5" cy="8.5" r="1.5"/%3E%3Ccircle cx="14.5" cy="8.5" r="1.5"/%3E%3C/svg%3E',
  mat_fish:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M6.5 12c.94-3.46 4.94-6 8.5-7 .17 3.12-1.13 6.75-3.5 8.5C14.63 15.25 15.17 18.88 15 22-11.44 21 7.44 15.46 6.5 12z"/%3E%3Cpath d="M18 7c.73 1.04 1.26 3.45.34 5.12M19 2l-1.5 3M19.5 9.5 22 8"/%3E%3Ccircle cx="10" cy="11" r="1"/%3E%3C/svg%3E',
  mat_tree:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M17 19h2a3 3 0 0 0 0-6h-1.17A6.5 6.5 0 0 0 5.8 9.5 4 4 0 0 0 5 17h2"/%3E%3Cpath d="M12 17V7l-3 3M12 7l3 3"/%3E%3C/svg%3E',
  mat_grid:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="3" width="18" height="18" rx="2"/%3E%3Cline x1="3" y1="9" x2="21" y2="9"/%3E%3Cline x1="3" y1="15" x2="21" y2="15"/%3E%3Cline x1="9" y1="3" x2="9" y2="21"/%3E%3Cline x1="15" y1="3" x2="15" y2="21"/%3E%3C/svg%3E',

  // === 手账类图标 ===
  mat_arrow:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cline x1="5" y1="12" x2="19" y2="12"/%3E%3Cpolyline points="12 5 19 12 12 19"/%3E%3C/svg%3E',
  mat_tag:      '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/%3E%3Cline x1="7" y1="7" x2="7.01" y2="7"/%3E%3C/svg%3E',
  mat_tape:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="8" width="18" height="8" rx="2"/%3E%3C/svg%3E',
  mat_note:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/%3E%3C/svg%3E',

  // === 思维导图类图标 ===
  mat_box:      '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="4" y="4" width="16" height="16" rx="2"/%3E%3C/svg%3E',
  mat_line:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cline x1="5" y1="19" x2="19" y2="5"/%3E%3C/svg%3E',
  mat_flag:     '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1"/%3E%3Cline x1="4" y1="22" x2="4" y2="15"/%3E%3C/svg%3E',

  // === UI 设计类图标 ===
  mat_button:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="8" width="18" height="8" rx="4"/%3E%3C/svg%3E',
  mat_input:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="3" y="6" width="18" height="12" rx="2"/%3E%3Cline x1="7" y1="12" x2="17" y2="12"/%3E%3C/svg%3E',
  mat_card:      '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="2" y="3" width="20" height="18" rx="3"/%3E%3Cline x1="2" y1="9" x2="22" y2="9"/%3E%3C/svg%3E',
  mat_navbar:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="2" y="2" width="20" height="20" rx="2"/%3E%3Cline x1="2" y1="7" x2="22" y2="7"/%3E%3C/svg%3E',

  // === 插画元素类图标 ===
  mat_plant:    '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M12 22V8"/%3E%3Cpath d="M5 8a7 7 0 0 1 14 0"/%3E%3Cpath d="M5 8l-2 6h18l-2-6"/%3E%3C/svg%3E',
  mat_building: '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Crect x="4" y="2" width="16" height="20" rx="2"/%3E%3Cline x1="4" y1="9" x2="20" y2="9"/%3E%3Cline x1="4" y1="15" x2="20" y2="15"/%3E%3Cline x1="9" y1="2" x2="9" y2="22"/%3E%3Cline x1="15" y1="2" x2="15" y2="22"/%3E%3C/svg%3E',
  mat_person:   '%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Ccircle cx="12" cy="8" r="4"/%3E%3Cpath d="M20 21a8 8 0 1 0-16 0"/%3E%3C/svg%3E',
};

/** 生成带颜色的 data URI */
function svgDataUri(svg: string, color: string): string {
  return `data:image/svg+xml,${svg.replace('COLOR', color)}`;
}

/** 全部图标名 */
type IconName = keyof typeof RAW_ICONS;

/** 亮色图标（stroke=#333） */
export const ICONS = Object.fromEntries(
  Object.entries(RAW_ICONS).map(([k, v]) => [k, svgDataUri(v, '%23333')])
) as Record<IconName, string>;

/** 暗色图标（stroke=#fff）—— 用于深色背景 */
export const ICONS_WHITE = Object.fromEntries(
  Object.entries(RAW_ICONS).map(([k, v]) => [k, svgDataUri(v, '%23fff')])
) as Record<IconName, string>;

// ===================== 颜色配置 =====================
export const COLORS = [
  '#000000', '#595959', '#8c8c8c', '#bfbfbf',
  '#f5222d', '#fa541c', '#fa8c16', '#fadb14',
  '#52c41a', '#13c2c2', '#1677ff', '#2f54eb',
  '#722ed1', '#eb2f96', '#ffffff',
];

export const BG_COLORS = [
  '#ffffff', '#f5f5f5', '#e8e8e8', '#d9d9d9',
  '#000000', '#595959', '#f5222d', '#fa8c16',
  '#fadb14', '#52c41a', '#1677ff', '#722ed1',
  '#eb2f96', 'transparent',
];

// ===================== 笔刷配置 =====================
export interface BrushItem {
  type: BrushType;
  name: string;
  icon: string;
}

export const BRUSHES: BrushItem[] = [
  { type: 'pencil',      name: '铅笔',   icon: ICONS.pencil },
  { type: 'marker',      name: '马克笔', icon: ICONS.marker },
  { type: 'highlighter', name: '荧光笔', icon: ICONS.highlighter },
  { type: 'eraser',      name: '橡皮',   icon: ICONS.eraser },
];

/** 笔刷类型 → 暗色图标映射 */
export const BRUSH_WHITE_ICONS: Record<BrushType, string> = {
  pencil:      ICONS_WHITE.pencil,
  marker:      ICONS_WHITE.marker,
  highlighter: ICONS_WHITE.highlighter,
  eraser:      ICONS_WHITE.eraser,
};

// ===================== 预设图形 =====================
// ShapeType 定义在 ../../utils/shapes，此处仅复用
export type { ShapeType };

export interface ShapeItem {
  type: ShapeType;
  name: string;
  icon: string;
}

export const SHAPES: ShapeItem[] = [
  { type: 'circle',   name: '圆形',   icon: '●' },
  { type: 'rect',     name: '矩形',   icon: '■' },
  { type: 'triangle', name: '三角形', icon: '▲' },
  { type: 'star5',    name: '五角星', icon: '★' },
  { type: 'heart',    name: '心形',   icon: '♥' },
];

// ===================== 素材库 =====================

/** 素材分类（张小龙：实用场景分类，删除幼稚的"贴纸"分类） */
export type MaterialCategory = 'all' | 'shape' | 'handbook' | 'mindmap' | 'uidesign' | 'illustration' | 'background';

/** 素材项 */
export interface MaterialItem {
  id: string;
  category: MaterialCategory;
  name: string;
  icon: string;
  type: 'svg_path' | 'emoji' | 'image_url';
  data: {
    paths?: string[];
    text?: string;
    url?: string;
  };
  defaultScale?: number;
  defaultColor?: string;
}

/** 素材库 */
export const MATERIAL_LIBRARY: MaterialItem[] = [
  // === 形状类 ===
  { id: 'shape_circle',    category: 'shape', name: '圆',     icon: ICONS.mat_circle,   type: 'svg_path', data: { paths: ['circle'] },    defaultScale: 0.5 },
  { id: 'shape_rect',      category: 'shape', name: '矩形',   icon: ICONS.mat_rect,     type: 'svg_path', data: { paths: ['rect'] },      defaultScale: 0.5 },
  { id: 'shape_triangle',  category: 'shape', name: '三角',   icon: ICONS.mat_triangle, type: 'svg_path', data: { paths: ['triangle'] },  defaultScale: 0.5 },
  { id: 'shape_star',      category: 'shape', name: '五角星', icon: ICONS.mat_star,     type: 'svg_path', data: { paths: ['star5'] },     defaultScale: 0.5 },
  { id: 'shape_heart',     category: 'shape', name: '心形',   icon: ICONS.mat_heart,    type: 'svg_path', data: { paths: ['heart'] },      defaultScale: 0.5 },

  // === 贴纸类 ===

  // === 背景类 ===
  { id: 'bg_grid',  category: 'background', name: '网格', icon: ICONS.mat_grid, type: 'image_url', data: { url: '/assets/bg_grid.png' }, defaultScale: 1.0 },

  // === 手账类（张小龙：实用场景，激发用户创作灵感） ===
  { id: 'hb_arrow_right',    category: 'handbook', name: '右箭头',   icon: ICONS.mat_arrow,     type: 'svg_path', data: { paths: ['arrow_right'] },    defaultScale: 0.4, defaultColor: '#FF6B6B' },
  { id: 'hb_arrow_down',     category: 'handbook', name: '下箭头',   icon: ICONS.mat_arrow,     type: 'svg_path', data: { paths: ['arrow_down'] },     defaultScale: 0.4, defaultColor: '#4ECDC4' },
  { id: 'hb_tag',           category: 'handbook', name: '标签',     icon: ICONS.mat_tag,       type: 'svg_path', data: { paths: ['tag'] },           defaultScale: 0.35, defaultColor: '#FFE66D' },
  { id: 'hb_tape',          category: 'handbook', name: '胶带',     icon: ICONS.mat_tape,      type: 'svg_path', data: { paths: ['tape'] },          defaultScale: 0.5, defaultColor: '#95E1D3' },
  { id: 'hb_note',          category: 'handbook', name: '便签',   icon: ICONS.mat_note,      type: 'svg_path', data: { paths: ['note'] },          defaultScale: 0.45, defaultColor: '#FFE66D' },

  // === 思维导图类 ===
  { id: 'mm_box',            category: 'mindmap', name: '框框',     icon: ICONS.mat_box,       type: 'svg_path', data: { paths: ['box'] },            defaultScale: 0.4, defaultColor: '#A8E6CF' },
  { id: 'mm_circle',        category: 'mindmap', name: '圆圈',     icon: ICONS.mat_circle,    type: 'svg_path', data: { paths: ['circle'] },        defaultScale: 0.35, defaultColor: '#FFD3B6' },
  { id: 'mm_line',          category: 'mindmap', name: '连线',     icon: ICONS.mat_line,      type: 'svg_path', data: { paths: ['line'] },          defaultScale: 0.5, defaultColor: '#6C5B7D' },
  { id: 'mm_icon_star',     category: 'mindmap', name: '图标★',   icon: ICONS.mat_star,      type: 'svg_path', data: { paths: ['star5'] },        defaultScale: 0.3, defaultColor: '#FF8C00' },
  { id: 'mm_icon_flag',     category: 'mindmap', name: '图标⚑',   icon: ICONS.mat_flag,      type: 'svg_path', data: { paths: ['flag'] },         defaultScale: 0.3, defaultColor: '#FF6B6B' },

  // === UI 设计类 ===
  { id: 'ui_button',        category: 'uidesign', name: '按钮',     icon: ICONS.mat_button,    type: 'svg_path', data: { paths: ['button'] },        defaultScale: 0.4, defaultColor: '#4ECDC4' },
  { id: 'ui_input',         category: 'uidesign', name: '输入框',   icon: ICONS.mat_input,     type: 'svg_path', data: { paths: ['input'] },         defaultScale: 0.4, defaultColor: '#95E1D3' },
  { id: 'ui_card',          category: 'uidesign', name: '卡片',     icon: ICONS.mat_card,      type: 'svg_path', data: { paths: ['card'] },          defaultScale: 0.45, defaultColor: '#FFE66D' },
  { id: 'ui_navbar',       category: 'uidesign', name: '导航栏',   icon: ICONS.mat_navbar,    type: 'svg_path', data: { paths: ['navbar'] },       defaultScale: 0.5, defaultColor: '#A8E6CF' },

  // === 插画元素类 ===
  { id: 'ill_plant',        category: 'illustration', name: '植物',   icon: ICONS.mat_plant,    type: 'svg_path', data: { paths: ['plant'] },        defaultScale: 0.4, defaultColor: '#2D8B4E' },
  { id: 'ill_building',     category: 'illustration', name: '建筑',   icon: ICONS.mat_building,  type: 'svg_path', data: { paths: ['building'] },     defaultScale: 0.45, defaultColor: '#6C5B7D' },
  { id: 'ill_person',       category: 'illustration', name: '人物',   icon: ICONS.mat_person,    type: 'svg_path', data: { paths: ['person'] },       defaultScale: 0.4, defaultColor: '#FF8C00' },
];

// ==================== 素材分类 ====================
export const MATERIAL_CATEGORIES = [
  { key: 'all', name: '全部' },
  { key: 'shape', name: '形状' },
  { key: 'handbook', name: '手账' },
  { key: 'mindmap', name: '思维导图' },
  { key: 'uidesign', name: 'UI设计' },
  { key: 'illustration', name: '插画' },
  { key: 'background', name: '背景' },
];

// SHAPE_DRAWERS 已迁移到 ../../utils/shapes
export {};
