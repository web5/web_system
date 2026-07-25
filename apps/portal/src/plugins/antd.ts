import type { App } from 'vue';
import {
  Button,
  Card,
  Avatar,
  Upload,
  Form,
  FormItem,
  Input,
  InputPassword,
  RadioGroup,
  RadioButton,
  Slider,
  Tabs,
  TabPane,
  ConfigProvider,
  App,
} from 'ant-design-vue';
import { message } from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import type { Rule } from 'ant-design-vue/es/form';

export { message } from 'ant-design-vue';
export type { Rule };

const components = [
  Button, Card, Avatar, Upload,
  Form, FormItem,
  Input, InputPassword,
  RadioGroup, RadioButton, Slider,
  Tabs, TabPane,
  ConfigProvider,
  App,
];

export function setupAntd(app: App) {
  components.forEach(comp => app.use(comp));
  app.use(message);
  message.config({ maxCount: 3 });
}
