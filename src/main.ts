import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./ui/App.vue";
import { router } from "./app/router";
import "./ui/styles.css";

createApp(App).use(createPinia()).use(router).mount("#app");
