<script setup lang="ts">
defineProps<{ name: string; size?: number }>();
const paths: Record<string, string[]> = {
  grid: ["M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z"],
  calendar: [
    "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z",
    "M16 3v4M8 3v4M3 11h18",
  ],
  box: ["m12 3 9 5v9l-9 5-9-5V8l9-5Z", "m3 8 9 5 9-5M12 13v9M7.5 5.5l9 5"],
  bag: ["M5 8h14l1 13H4L5 8Z", "M8 9V6a4 4 0 0 1 8 0v3"],
  layers: ["m12 3 10 5-10 5L2 8l10-5Z", "m2 12 10 5 10-5M2 16l10 5 10-5"],
  chart: ["M4 3v17h17M8 16v-4M13 16V8M18 16V5"],
  file: [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z",
    "M14 2v6h6M8 13h8M8 17h5",
  ],
  arrow: ["M5 12h14m-6-6 6 6-6 6"],
  download: ["M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"],
  plus: ["M12 5v14M5 12h14"],
  check: ["m5 12 4 4L19 6"],
  shield: ["m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z", "m8 12 3 3 5-6"],
  info: ["M12 16v-4M12 8h.01", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"],
  wifi: [
    "M2 8a17 17 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01",
  ],
  close: ["m6 6 12 12M6 18 18 6"],
};
</script>
<template>
  <svg
    :width="size || 20"
    :height="size || 20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(path, i) in paths[name] || paths.file" :key="i" :d="path" />
  </svg>
</template>
