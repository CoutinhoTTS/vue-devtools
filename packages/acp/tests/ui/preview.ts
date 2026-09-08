import { createApp } from 'vue'
import Preview from './Preview.vue'
import '@unocss/reset/tailwind.css'
import '@vue/devtools-ui/style.css'
import 'uno.css'

document.documentElement.style.height = '100%'
document.body.style.height = '100%'
document.getElementById('app')!.style.height = '100%'
createApp(Preview).mount('#app')
