import type { App } from 'vue';
import {
  Button,
  Card,
  Avatar,
  Upload,
  Form,
  Input,
  Radio,
  Alert,
  Slider,
  Tabs,
  Dropdown,
  Menu,
  Modal,
  ConfigProvider,
  App as AntdApp,
} from 'ant-design-vue';
import { message } from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import type { Rule } from 'ant-design-vue/es/form';

export { message } from 'ant-design-vue';
export type { Rule };

/**
 * Ant Design Vue 4.x：**只注册顶层组件**（带 install 方法的）。
 * 子组件由父组件 install 时自动注册；单独注册无 install 的子组件会静默失效
 * （并触发 "A plugin must either be a function or an object with an install function" 警告）。
 *
 * ⚠️ 2026-09-23 修缺陷：原列表注册的是 RadioGroup / RadioButton（子组件、**无 install**），
 * 而**父组件 Radio 从未注册** → 二者都没被注册，模板里的 `<a-radio-group>` 变成未解析标签、
 * 整块不渲染（portal「我的 → 偏好 → 圆角风格」三档选择器长期不可见，用户无法修改偏好）。
 * 现改为注册父组件 Radio（其 install 自动注册 ARadioGroup / ARadioButton），并补上缺失的
 * Alert（「我的」页 API Key 区块在用）。口径与 apps/admin/src/plugins/antd.ts 对齐。
 * 规格：specs/radius-style-dual/page-spec-pref-sync.md §5.1
 */
const components = [
  Button, Card, Avatar, Upload,
  Form, // 自动注册 FormItem
  Input, // 自动注册 InputPassword 等
  Radio, // ⚠️ 必须注册父组件：RadioGroup / RadioButton 由其 install 自动注册
  Alert,
  Slider,
  Tabs, // 自动注册 TabPane
  Dropdown, Menu, // Menu 自动注册 MenuItem / MenuDivider
  Modal,
  ConfigProvider,
  AntdApp,
];

export function setupAntd(app: App) {
  components.forEach(comp => app.use(comp));
  app.use(message);
  message.config({ maxCount: 3 });
}
