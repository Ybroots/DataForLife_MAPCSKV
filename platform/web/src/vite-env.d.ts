/// <reference types="vite/client" />

/** true khi build dành riêng cho người dân (Android). Được Vite thay bằng literal lúc build. */
declare const __CITIZEN_ONLY__: boolean;

/** true khi build app Android dành cho cán bộ CSKV (mode android-officer): mở thẳng cổng nghiệp vụ. */
declare const __OFFICER_APP__: boolean;
