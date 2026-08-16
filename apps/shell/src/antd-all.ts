import type { App as VueApp } from 'vue';
import {
  Affix, Anchor, AutoComplete, Alert, Avatar, Badge, Breadcrumb, Button, Calendar,
  Card, Collapse, Carousel, Cascader, Checkbox, Col, Comment, ConfigProvider, DatePicker,
  Descriptions, Divider, Dropdown, Drawer, Empty, FloatButton, Form, Grid, Input, Image,
  InputNumber, Layout, List, Menu, Mentions, Modal, Statistic, PageHeader, Pagination,
  Popconfirm, Popover, Progress, Radio, Rate, Result, Row, Select, Skeleton, Slider,
  Space, Spin, Steps, Switch, Table, Transfer, Tree, TreeSelect, Tabs, Tag, TimePicker,
  Timeline, Tooltip, Typography, Upload, LocaleProvider, Watermark, Segmented, QRCode,
  Tour, App, Flex,
} from 'ant-design-vue';

/**
 * 全量注册 antd 组件（显式 import 每个组件，逐个 use）。
 * 为什么不用 app.use(Antd)：
 *   antd 的 install 内部是 `Object.keys(components).forEach(...)` 动态遍历，
 *   rollup 静态追踪不到具体组件，tree-shaking 只保留 shell 自己 import 用到的
 *   组件（Input/Modal 等），导致模块用到的 Table/Tabs/Select 的 cssinjs 样式
 *   模板被打包时删掉，运行时无样式。
 * 显式 import 后 rollup 一定保留所有组件 + 其 style 模块。
 */
const components: Array<{ install?: (app: VueApp) => void }> = [
  Affix, Anchor, AutoComplete, Alert, Avatar, Badge, Breadcrumb, Button, Calendar,
  Card, Collapse, Carousel, Cascader, Checkbox, Col, Comment, ConfigProvider, DatePicker,
  Descriptions, Divider, Dropdown, Drawer, Empty, FloatButton, Form, Grid, Input, Image,
  InputNumber, Layout, List, Menu, Mentions, Modal, Statistic, PageHeader, Pagination,
  Popconfirm, Popover, Progress, Radio, Rate, Result, Row, Select, Skeleton, Slider,
  Space, Spin, Steps, Switch, Table, Transfer, Tree, TreeSelect, Tabs, Tag, TimePicker,
  Timeline, Tooltip, Typography, Upload, LocaleProvider, Watermark, Segmented, QRCode,
  Tour, App, Flex,
];

export function setupAntdAll(app: VueApp) {
  components.forEach((c) => {
    if (c && typeof c.install === 'function') {
      app.use(c as any);
    }
  });
}
