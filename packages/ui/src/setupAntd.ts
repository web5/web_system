import type { App } from 'vue';
import {
  Button,
  Card,
  Avatar,
  Upload,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  Badge,
  Space,
  Tooltip,
  Popconfirm,
  Modal,
  Tabs,
  Descriptions,
  Divider,
  Statistic,
  Checkbox,
  Radio,
  DatePicker,
  Empty,
  Spin,
  Layout,
  Menu,
  Breadcrumb,
  Dropdown,
  Row,
  Col,
  Table,
  ConfigProvider,
} from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';

export { message } from 'ant-design-vue';

/**
 * Ant Design Vue 4.x：仅注册顶层组件（有 install 方法）。
 * 子组件（FormItem / SelectOption / TabPane / MenuItem 等）
 * 由父组件 install 时自动注册，无需重复注册。
 */
const components = [
  Button, Card, Avatar, Upload,
  Form, Input, InputNumber, Select,
  Switch, Tag, Badge, Space,
  Tooltip, Popconfirm, Modal, Tabs,
  Descriptions, Divider, Statistic,
  Checkbox, Radio, DatePicker, Empty, Spin,
  Layout, Menu, Breadcrumb, Dropdown,
  Row, Col, Table, ConfigProvider,
];

/** 统一注册 AntD 组件（各前端 app 复用，避免重复清单） */
export function setupAntd(app: App): void {
  components.forEach((comp) => app.use(comp));
}
