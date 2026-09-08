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
  Alert,
  Drawer,
} from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';

export { message } from 'ant-design-vue';

/**
 * Ant Design Vue 4.x: 仅注册顶层组件（有 install 方法）。
 * 子组件（FormItem / SelectOption / TabPane / MenuItem / RadioGroup / DescriptionsItem /
 * InputPassword / InputSearch / Textarea / LayoutSider / MenuDivider / BreadcrumbItem 等）
 * 由父组件 install 时自动注册，无需重复注册，否则触发 "A plugin must either be a function" 警告。
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
  Alert, Drawer,
];

export function setupAntd(app: App) {
  components.forEach(comp => app.use(comp));
}
