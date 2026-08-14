import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { antdTheme } from '@web-system/ui';
import { listModules, createModule, updateModule, deleteModule, toggleModule, debugCall, } from './api';
// ── 状态 ──
const modules = ref([]);
const loading = ref(false);
// 添加/编辑弹窗
const editVisible = ref(false);
const editingId = ref(null);
const editForm = reactive({
    name: '',
    description: '',
    base_url: '',
    timeout: 30,
    auth_type: '',
    tools: [],
});
// 调试弹窗
const debugVisible = ref(false);
const debugModule = ref(null);
const debugTool = ref('');
const debugArgs = reactive({});
const debugResult = ref('');
const debugLoading = ref(false);
// ── 加载 ──
async function load() {
    loading.value = true;
    try {
        modules.value = await listModules();
    }
    catch (e) {
        message.error(e?.response?.data?.error || e.message || '加载失败');
    }
    finally {
        loading.value = false;
    }
}
onMounted(load);
// ── 添加/编辑 ──
function openCreate() {
    editingId.value = null;
    Object.assign(editForm, {
        name: '',
        description: '',
        base_url: '',
        timeout: 30,
        auth_type: '',
        tools: [],
    });
    editVisible.value = true;
}
function openEdit(m) {
    editingId.value = m.id;
    Object.assign(editForm, {
        name: m.name,
        description: m.description,
        base_url: m.base_url,
        timeout: m.timeout,
        auth_type: m.auth_type,
        tools: JSON.parse(JSON.stringify(m.tools ?? [])),
    });
    editVisible.value = true;
}
function addTool() {
    editForm.tools.push({ name: '', description: '', method: 'GET', path: '/', params: [] });
}
function removeTool(i) {
    editForm.tools.splice(i, 1);
}
function addParam(tool) {
    if (!tool.params)
        tool.params = [];
    tool.params.push({ name: '', type: 'string', required: false, description: '' });
}
function removeParam(tool, i) {
    tool.params.splice(i, 1);
}
async function submitEdit() {
    if (!editForm.name || !editForm.base_url) {
        message.warning('请填写模块名和 base_url');
        return;
    }
    for (const t of editForm.tools) {
        if (!t.name || !t.path) {
            message.warning('工具的 name 和 path 必填');
            return;
        }
    }
    try {
        const dto = {
            name: editForm.name,
            description: editForm.description,
            base_url: editForm.base_url,
            timeout: editForm.timeout,
            auth_type: editForm.auth_type,
            tools: editForm.tools,
        };
        if (editingId.value) {
            await updateModule(editingId.value, dto);
            message.success('模块已更新');
        }
        else {
            await createModule(dto);
            message.success('模块已创建');
        }
        editVisible.value = false;
        load();
    }
    catch (e) {
        message.error(e?.response?.data?.error || e.message || '保存失败');
    }
}
// ── 删除 ──
async function onDelete(m) {
    await deleteModule(m.id);
    message.success('已删除');
    load();
}
// ── 启停 ──
async function onToggle(m, checked) {
    try {
        await toggleModule(m.id, checked);
        message.success(checked ? '已启用' : '已停用');
        load();
    }
    catch (e) {
        message.error(e?.response?.data?.error || e.message || '操作失败');
    }
}
// ── 调试 ──
function openDebug(m) {
    debugModule.value = m;
    debugTool.value = m.tools?.[0]?.name ?? '';
    Object.keys(debugArgs).forEach((k) => delete debugArgs[k]);
    debugResult.value = '';
    debugVisible.value = true;
}
const currentTool = () => debugModule.value?.tools?.find((t) => t.name === debugTool.value);
async function runDebug() {
    const tool = currentTool();
    if (!tool || !debugModule.value)
        return;
    // 构造参数
    const args = {};
    for (const p of tool.params ?? []) {
        const v = debugArgs[p.name];
        if (p.required && (v === undefined || v === '' || v === null)) {
            message.warning(`参数 ${p.name} 必填`);
            return;
        }
        if (v !== undefined && v !== '' && v !== null) {
            args[p.name] = p.type === 'integer' || p.type === 'number' ? Number(v) : v;
        }
    }
    debugLoading.value = true;
    try {
        const result = await debugCall({
            base_url: debugModule.value.base_url,
            method: tool.method,
            path: tool.path,
            params: args,
        });
        debugResult.value = JSON.stringify(result, null, 2);
    }
    catch (e) {
        debugResult.value = JSON.stringify({ error: e?.response?.data?.error || e?.response?.data?.message || e.message || '调用失败' }, null, 2);
    }
    finally {
        debugLoading.value = false;
    }
}
// ── 表格列 ──
const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '模块名', dataIndex: 'name', width: 160 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '服务地址', dataIndex: 'base_url', ellipsis: true },
    { title: '工具数', key: 'toolCount', width: 80 },
    { title: '状态', key: 'enabled', width: 80 },
    { title: '操作', key: 'action', width: 220 },
];
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_components;
let __VLS_directives;
// CSS variable injection 
// CSS variable injection end 
const __VLS_0 = {}.AConfigProvider;
/** @type {[typeof __VLS_components.AConfigProvider, typeof __VLS_components.aConfigProvider, typeof __VLS_components.AConfigProvider, typeof __VLS_components.aConfigProvider, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    theme: (__VLS_ctx.antdTheme),
}));
const __VLS_2 = __VLS_1({
    theme: (__VLS_ctx.antdTheme),
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
var __VLS_4 = {};
__VLS_3.slots.default;
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "page" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
const __VLS_5 = {}.AButton;
/** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
// @ts-ignore
const __VLS_6 = __VLS_asFunctionalComponent(__VLS_5, new __VLS_5({
    ...{ 'onClick': {} },
    type: "primary",
}));
const __VLS_7 = __VLS_6({
    ...{ 'onClick': {} },
    type: "primary",
}, ...__VLS_functionalComponentArgsRest(__VLS_6));
let __VLS_9;
let __VLS_10;
let __VLS_11;
const __VLS_12 = {
    onClick: (__VLS_ctx.openCreate)
};
__VLS_8.slots.default;
var __VLS_8;
const __VLS_13 = {}.ATable;
/** @type {[typeof __VLS_components.ATable, typeof __VLS_components.aTable, typeof __VLS_components.ATable, typeof __VLS_components.aTable, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
    columns: (__VLS_ctx.columns),
    dataSource: (__VLS_ctx.modules),
    loading: (__VLS_ctx.loading),
    rowKey: "id",
    pagination: (false),
    size: "middle",
}));
const __VLS_15 = __VLS_14({
    columns: (__VLS_ctx.columns),
    dataSource: (__VLS_ctx.modules),
    loading: (__VLS_ctx.loading),
    rowKey: "id",
    pagination: (false),
    size: "middle",
}, ...__VLS_functionalComponentArgsRest(__VLS_14));
__VLS_16.slots.default;
{
    const { bodyCell: __VLS_thisSlot } = __VLS_16.slots;
    const [{ column, record }] = __VLS_getSlotParams(__VLS_thisSlot);
    if (column.key === 'toolCount') {
        const __VLS_17 = {}.ATag;
        /** @type {[typeof __VLS_components.ATag, typeof __VLS_components.aTag, typeof __VLS_components.ATag, typeof __VLS_components.aTag, ]} */ ;
        // @ts-ignore
        const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({
            color: "blue",
        }));
        const __VLS_19 = __VLS_18({
            color: "blue",
        }, ...__VLS_functionalComponentArgsRest(__VLS_18));
        __VLS_20.slots.default;
        (record.tools?.length ?? 0);
        var __VLS_20;
    }
    else if (column.key === 'enabled') {
        const __VLS_21 = {}.ASwitch;
        /** @type {[typeof __VLS_components.ASwitch, typeof __VLS_components.aSwitch, ]} */ ;
        // @ts-ignore
        const __VLS_22 = __VLS_asFunctionalComponent(__VLS_21, new __VLS_21({
            ...{ 'onChange': {} },
            checked: (record.enabled === 1),
        }));
        const __VLS_23 = __VLS_22({
            ...{ 'onChange': {} },
            checked: (record.enabled === 1),
        }, ...__VLS_functionalComponentArgsRest(__VLS_22));
        let __VLS_25;
        let __VLS_26;
        let __VLS_27;
        const __VLS_28 = {
            onChange: ((checked) => __VLS_ctx.onToggle(record, checked))
        };
        var __VLS_24;
    }
    else if (column.key === 'action') {
        const __VLS_29 = {}.ASpace;
        /** @type {[typeof __VLS_components.ASpace, typeof __VLS_components.aSpace, typeof __VLS_components.ASpace, typeof __VLS_components.aSpace, ]} */ ;
        // @ts-ignore
        const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({}));
        const __VLS_31 = __VLS_30({}, ...__VLS_functionalComponentArgsRest(__VLS_30));
        __VLS_32.slots.default;
        const __VLS_33 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({
            ...{ 'onClick': {} },
            size: "small",
        }));
        const __VLS_35 = __VLS_34({
            ...{ 'onClick': {} },
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_34));
        let __VLS_37;
        let __VLS_38;
        let __VLS_39;
        const __VLS_40 = {
            onClick: (...[$event]) => {
                if (!!(column.key === 'toolCount'))
                    return;
                if (!!(column.key === 'enabled'))
                    return;
                if (!(column.key === 'action'))
                    return;
                __VLS_ctx.openDebug(record);
            }
        };
        __VLS_36.slots.default;
        var __VLS_36;
        const __VLS_41 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_42 = __VLS_asFunctionalComponent(__VLS_41, new __VLS_41({
            ...{ 'onClick': {} },
            size: "small",
        }));
        const __VLS_43 = __VLS_42({
            ...{ 'onClick': {} },
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_42));
        let __VLS_45;
        let __VLS_46;
        let __VLS_47;
        const __VLS_48 = {
            onClick: (...[$event]) => {
                if (!!(column.key === 'toolCount'))
                    return;
                if (!!(column.key === 'enabled'))
                    return;
                if (!(column.key === 'action'))
                    return;
                __VLS_ctx.openEdit(record);
            }
        };
        __VLS_44.slots.default;
        var __VLS_44;
        const __VLS_49 = {}.APopconfirm;
        /** @type {[typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, ]} */ ;
        // @ts-ignore
        const __VLS_50 = __VLS_asFunctionalComponent(__VLS_49, new __VLS_49({
            ...{ 'onConfirm': {} },
            title: "确定删除该模块？",
        }));
        const __VLS_51 = __VLS_50({
            ...{ 'onConfirm': {} },
            title: "确定删除该模块？",
        }, ...__VLS_functionalComponentArgsRest(__VLS_50));
        let __VLS_53;
        let __VLS_54;
        let __VLS_55;
        const __VLS_56 = {
            onConfirm: (...[$event]) => {
                if (!!(column.key === 'toolCount'))
                    return;
                if (!!(column.key === 'enabled'))
                    return;
                if (!(column.key === 'action'))
                    return;
                __VLS_ctx.onDelete(record);
            }
        };
        __VLS_52.slots.default;
        const __VLS_57 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_58 = __VLS_asFunctionalComponent(__VLS_57, new __VLS_57({
            size: "small",
            danger: true,
        }));
        const __VLS_59 = __VLS_58({
            size: "small",
            danger: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_58));
        __VLS_60.slots.default;
        var __VLS_60;
        var __VLS_52;
        var __VLS_32;
    }
}
var __VLS_16;
const __VLS_61 = {}.AModal;
/** @type {[typeof __VLS_components.AModal, typeof __VLS_components.aModal, typeof __VLS_components.AModal, typeof __VLS_components.aModal, ]} */ ;
// @ts-ignore
const __VLS_62 = __VLS_asFunctionalComponent(__VLS_61, new __VLS_61({
    ...{ 'onOk': {} },
    open: (__VLS_ctx.editVisible),
    title: (__VLS_ctx.editingId ? '编辑模块' : '添加模块'),
    width: "760px",
}));
const __VLS_63 = __VLS_62({
    ...{ 'onOk': {} },
    open: (__VLS_ctx.editVisible),
    title: (__VLS_ctx.editingId ? '编辑模块' : '添加模块'),
    width: "760px",
}, ...__VLS_functionalComponentArgsRest(__VLS_62));
let __VLS_65;
let __VLS_66;
let __VLS_67;
const __VLS_68 = {
    onOk: (__VLS_ctx.submitEdit)
};
__VLS_64.slots.default;
const __VLS_69 = {}.AForm;
/** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
// @ts-ignore
const __VLS_70 = __VLS_asFunctionalComponent(__VLS_69, new __VLS_69({
    layout: "vertical",
}));
const __VLS_71 = __VLS_70({
    layout: "vertical",
}, ...__VLS_functionalComponentArgsRest(__VLS_70));
__VLS_72.slots.default;
const __VLS_73 = {}.ARow;
/** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
// @ts-ignore
const __VLS_74 = __VLS_asFunctionalComponent(__VLS_73, new __VLS_73({
    gutter: (16),
}));
const __VLS_75 = __VLS_74({
    gutter: (16),
}, ...__VLS_functionalComponentArgsRest(__VLS_74));
__VLS_76.slots.default;
const __VLS_77 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_78 = __VLS_asFunctionalComponent(__VLS_77, new __VLS_77({
    span: (12),
}));
const __VLS_79 = __VLS_78({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_78));
__VLS_80.slots.default;
const __VLS_81 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_82 = __VLS_asFunctionalComponent(__VLS_81, new __VLS_81({
    label: "模块名",
    required: true,
}));
const __VLS_83 = __VLS_82({
    label: "模块名",
    required: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_82));
__VLS_84.slots.default;
const __VLS_85 = {}.AInput;
/** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
// @ts-ignore
const __VLS_86 = __VLS_asFunctionalComponent(__VLS_85, new __VLS_85({
    value: (__VLS_ctx.editForm.name),
    placeholder: "如：用户服务",
}));
const __VLS_87 = __VLS_86({
    value: (__VLS_ctx.editForm.name),
    placeholder: "如：用户服务",
}, ...__VLS_functionalComponentArgsRest(__VLS_86));
var __VLS_84;
var __VLS_80;
const __VLS_89 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_90 = __VLS_asFunctionalComponent(__VLS_89, new __VLS_89({
    span: (12),
}));
const __VLS_91 = __VLS_90({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_90));
__VLS_92.slots.default;
const __VLS_93 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_94 = __VLS_asFunctionalComponent(__VLS_93, new __VLS_93({
    label: "描述",
}));
const __VLS_95 = __VLS_94({
    label: "描述",
}, ...__VLS_functionalComponentArgsRest(__VLS_94));
__VLS_96.slots.default;
const __VLS_97 = {}.AInput;
/** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
// @ts-ignore
const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({
    value: (__VLS_ctx.editForm.description),
}));
const __VLS_99 = __VLS_98({
    value: (__VLS_ctx.editForm.description),
}, ...__VLS_functionalComponentArgsRest(__VLS_98));
var __VLS_96;
var __VLS_92;
var __VLS_76;
const __VLS_101 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_102 = __VLS_asFunctionalComponent(__VLS_101, new __VLS_101({
    label: "服务地址 base_url",
    required: true,
}));
const __VLS_103 = __VLS_102({
    label: "服务地址 base_url",
    required: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_102));
__VLS_104.slots.default;
const __VLS_105 = {}.AInput;
/** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
// @ts-ignore
const __VLS_106 = __VLS_asFunctionalComponent(__VLS_105, new __VLS_105({
    value: (__VLS_ctx.editForm.base_url),
    placeholder: "http://172.16.16.10:8080",
}));
const __VLS_107 = __VLS_106({
    value: (__VLS_ctx.editForm.base_url),
    placeholder: "http://172.16.16.10:8080",
}, ...__VLS_functionalComponentArgsRest(__VLS_106));
var __VLS_104;
const __VLS_109 = {}.ARow;
/** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
// @ts-ignore
const __VLS_110 = __VLS_asFunctionalComponent(__VLS_109, new __VLS_109({
    gutter: (16),
}));
const __VLS_111 = __VLS_110({
    gutter: (16),
}, ...__VLS_functionalComponentArgsRest(__VLS_110));
__VLS_112.slots.default;
const __VLS_113 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_114 = __VLS_asFunctionalComponent(__VLS_113, new __VLS_113({
    span: (12),
}));
const __VLS_115 = __VLS_114({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_114));
__VLS_116.slots.default;
const __VLS_117 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_118 = __VLS_asFunctionalComponent(__VLS_117, new __VLS_117({
    label: "超时（秒）",
}));
const __VLS_119 = __VLS_118({
    label: "超时（秒）",
}, ...__VLS_functionalComponentArgsRest(__VLS_118));
__VLS_120.slots.default;
const __VLS_121 = {}.AInputNumber;
/** @type {[typeof __VLS_components.AInputNumber, typeof __VLS_components.aInputNumber, ]} */ ;
// @ts-ignore
const __VLS_122 = __VLS_asFunctionalComponent(__VLS_121, new __VLS_121({
    value: (__VLS_ctx.editForm.timeout),
    min: (1),
    ...{ style: {} },
}));
const __VLS_123 = __VLS_122({
    value: (__VLS_ctx.editForm.timeout),
    min: (1),
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_122));
var __VLS_120;
var __VLS_116;
const __VLS_125 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_126 = __VLS_asFunctionalComponent(__VLS_125, new __VLS_125({
    span: (12),
}));
const __VLS_127 = __VLS_126({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_126));
__VLS_128.slots.default;
const __VLS_129 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_130 = __VLS_asFunctionalComponent(__VLS_129, new __VLS_129({
    label: "鉴权类型",
}));
const __VLS_131 = __VLS_130({
    label: "鉴权类型",
}, ...__VLS_functionalComponentArgsRest(__VLS_130));
__VLS_132.slots.default;
const __VLS_133 = {}.ASelect;
/** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
// @ts-ignore
const __VLS_134 = __VLS_asFunctionalComponent(__VLS_133, new __VLS_133({
    value: (__VLS_ctx.editForm.auth_type),
    placeholder: "无鉴权",
}));
const __VLS_135 = __VLS_134({
    value: (__VLS_ctx.editForm.auth_type),
    placeholder: "无鉴权",
}, ...__VLS_functionalComponentArgsRest(__VLS_134));
__VLS_136.slots.default;
const __VLS_137 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_138 = __VLS_asFunctionalComponent(__VLS_137, new __VLS_137({
    value: "",
}));
const __VLS_139 = __VLS_138({
    value: "",
}, ...__VLS_functionalComponentArgsRest(__VLS_138));
__VLS_140.slots.default;
var __VLS_140;
const __VLS_141 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_142 = __VLS_asFunctionalComponent(__VLS_141, new __VLS_141({
    value: "bearer",
}));
const __VLS_143 = __VLS_142({
    value: "bearer",
}, ...__VLS_functionalComponentArgsRest(__VLS_142));
__VLS_144.slots.default;
var __VLS_144;
const __VLS_145 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_146 = __VLS_asFunctionalComponent(__VLS_145, new __VLS_145({
    value: "basic",
}));
const __VLS_147 = __VLS_146({
    value: "basic",
}, ...__VLS_functionalComponentArgsRest(__VLS_146));
__VLS_148.slots.default;
var __VLS_148;
const __VLS_149 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_150 = __VLS_asFunctionalComponent(__VLS_149, new __VLS_149({
    value: "header",
}));
const __VLS_151 = __VLS_150({
    value: "header",
}, ...__VLS_functionalComponentArgsRest(__VLS_150));
__VLS_152.slots.default;
var __VLS_152;
var __VLS_136;
var __VLS_132;
var __VLS_128;
var __VLS_112;
const __VLS_153 = {}.ADivider;
/** @type {[typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, ]} */ ;
// @ts-ignore
const __VLS_154 = __VLS_asFunctionalComponent(__VLS_153, new __VLS_153({}));
const __VLS_155 = __VLS_154({}, ...__VLS_functionalComponentArgsRest(__VLS_154));
__VLS_156.slots.default;
var __VLS_156;
for (const [tool, ti] of __VLS_getVForSourceType((__VLS_ctx.editForm.tools))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        key: (ti),
        ...{ class: "tool-card" },
    });
    const __VLS_157 = {}.ARow;
    /** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
    // @ts-ignore
    const __VLS_158 = __VLS_asFunctionalComponent(__VLS_157, new __VLS_157({
        gutter: (8),
    }));
    const __VLS_159 = __VLS_158({
        gutter: (8),
    }, ...__VLS_functionalComponentArgsRest(__VLS_158));
    __VLS_160.slots.default;
    const __VLS_161 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_162 = __VLS_asFunctionalComponent(__VLS_161, new __VLS_161({
        span: (6),
    }));
    const __VLS_163 = __VLS_162({
        span: (6),
    }, ...__VLS_functionalComponentArgsRest(__VLS_162));
    __VLS_164.slots.default;
    const __VLS_165 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_166 = __VLS_asFunctionalComponent(__VLS_165, new __VLS_165({
        value: (tool.name),
        placeholder: "工具名",
    }));
    const __VLS_167 = __VLS_166({
        value: (tool.name),
        placeholder: "工具名",
    }, ...__VLS_functionalComponentArgsRest(__VLS_166));
    var __VLS_164;
    const __VLS_169 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_170 = __VLS_asFunctionalComponent(__VLS_169, new __VLS_169({
        span: (5),
    }));
    const __VLS_171 = __VLS_170({
        span: (5),
    }, ...__VLS_functionalComponentArgsRest(__VLS_170));
    __VLS_172.slots.default;
    const __VLS_173 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_174 = __VLS_asFunctionalComponent(__VLS_173, new __VLS_173({
        value: (tool.description),
        placeholder: "描述",
    }));
    const __VLS_175 = __VLS_174({
        value: (tool.description),
        placeholder: "描述",
    }, ...__VLS_functionalComponentArgsRest(__VLS_174));
    var __VLS_172;
    const __VLS_177 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_178 = __VLS_asFunctionalComponent(__VLS_177, new __VLS_177({
        span: (4),
    }));
    const __VLS_179 = __VLS_178({
        span: (4),
    }, ...__VLS_functionalComponentArgsRest(__VLS_178));
    __VLS_180.slots.default;
    const __VLS_181 = {}.ASelect;
    /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
    // @ts-ignore
    const __VLS_182 = __VLS_asFunctionalComponent(__VLS_181, new __VLS_181({
        value: (tool.method),
    }));
    const __VLS_183 = __VLS_182({
        value: (tool.method),
    }, ...__VLS_functionalComponentArgsRest(__VLS_182));
    __VLS_184.slots.default;
    const __VLS_185 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_186 = __VLS_asFunctionalComponent(__VLS_185, new __VLS_185({
        value: "GET",
    }));
    const __VLS_187 = __VLS_186({
        value: "GET",
    }, ...__VLS_functionalComponentArgsRest(__VLS_186));
    __VLS_188.slots.default;
    var __VLS_188;
    const __VLS_189 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_190 = __VLS_asFunctionalComponent(__VLS_189, new __VLS_189({
        value: "POST",
    }));
    const __VLS_191 = __VLS_190({
        value: "POST",
    }, ...__VLS_functionalComponentArgsRest(__VLS_190));
    __VLS_192.slots.default;
    var __VLS_192;
    const __VLS_193 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_194 = __VLS_asFunctionalComponent(__VLS_193, new __VLS_193({
        value: "PUT",
    }));
    const __VLS_195 = __VLS_194({
        value: "PUT",
    }, ...__VLS_functionalComponentArgsRest(__VLS_194));
    __VLS_196.slots.default;
    var __VLS_196;
    const __VLS_197 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_198 = __VLS_asFunctionalComponent(__VLS_197, new __VLS_197({
        value: "PATCH",
    }));
    const __VLS_199 = __VLS_198({
        value: "PATCH",
    }, ...__VLS_functionalComponentArgsRest(__VLS_198));
    __VLS_200.slots.default;
    var __VLS_200;
    const __VLS_201 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_202 = __VLS_asFunctionalComponent(__VLS_201, new __VLS_201({
        value: "DELETE",
    }));
    const __VLS_203 = __VLS_202({
        value: "DELETE",
    }, ...__VLS_functionalComponentArgsRest(__VLS_202));
    __VLS_204.slots.default;
    var __VLS_204;
    var __VLS_184;
    var __VLS_180;
    const __VLS_205 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_206 = __VLS_asFunctionalComponent(__VLS_205, new __VLS_205({
        span: (6),
    }));
    const __VLS_207 = __VLS_206({
        span: (6),
    }, ...__VLS_functionalComponentArgsRest(__VLS_206));
    __VLS_208.slots.default;
    const __VLS_209 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_210 = __VLS_asFunctionalComponent(__VLS_209, new __VLS_209({
        value: (tool.path),
        placeholder: "/api/xxx/{id}",
    }));
    const __VLS_211 = __VLS_210({
        value: (tool.path),
        placeholder: "/api/xxx/{id}",
    }, ...__VLS_functionalComponentArgsRest(__VLS_210));
    var __VLS_208;
    const __VLS_213 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_214 = __VLS_asFunctionalComponent(__VLS_213, new __VLS_213({
        span: (3),
    }));
    const __VLS_215 = __VLS_214({
        span: (3),
    }, ...__VLS_functionalComponentArgsRest(__VLS_214));
    __VLS_216.slots.default;
    const __VLS_217 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_218 = __VLS_asFunctionalComponent(__VLS_217, new __VLS_217({
        ...{ 'onClick': {} },
        size: "small",
        danger: true,
    }));
    const __VLS_219 = __VLS_218({
        ...{ 'onClick': {} },
        size: "small",
        danger: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_218));
    let __VLS_221;
    let __VLS_222;
    let __VLS_223;
    const __VLS_224 = {
        onClick: (...[$event]) => {
            __VLS_ctx.removeTool(ti);
        }
    };
    __VLS_220.slots.default;
    var __VLS_220;
    var __VLS_216;
    var __VLS_160;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "param-list" },
    });
    for (const [p, pi] of __VLS_getVForSourceType((tool.params))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (pi),
            ...{ class: "param-row" },
        });
        const __VLS_225 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_226 = __VLS_asFunctionalComponent(__VLS_225, new __VLS_225({
            value: (p.name),
            placeholder: "参数名",
            size: "small",
            ...{ style: {} },
        }));
        const __VLS_227 = __VLS_226({
            value: (p.name),
            placeholder: "参数名",
            size: "small",
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_226));
        const __VLS_229 = {}.ASelect;
        /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
        // @ts-ignore
        const __VLS_230 = __VLS_asFunctionalComponent(__VLS_229, new __VLS_229({
            value: (p.type),
            size: "small",
            ...{ style: {} },
        }));
        const __VLS_231 = __VLS_230({
            value: (p.type),
            size: "small",
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_230));
        __VLS_232.slots.default;
        const __VLS_233 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_234 = __VLS_asFunctionalComponent(__VLS_233, new __VLS_233({
            value: "string",
        }));
        const __VLS_235 = __VLS_234({
            value: "string",
        }, ...__VLS_functionalComponentArgsRest(__VLS_234));
        __VLS_236.slots.default;
        var __VLS_236;
        const __VLS_237 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_238 = __VLS_asFunctionalComponent(__VLS_237, new __VLS_237({
            value: "integer",
        }));
        const __VLS_239 = __VLS_238({
            value: "integer",
        }, ...__VLS_functionalComponentArgsRest(__VLS_238));
        __VLS_240.slots.default;
        var __VLS_240;
        const __VLS_241 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_242 = __VLS_asFunctionalComponent(__VLS_241, new __VLS_241({
            value: "number",
        }));
        const __VLS_243 = __VLS_242({
            value: "number",
        }, ...__VLS_functionalComponentArgsRest(__VLS_242));
        __VLS_244.slots.default;
        var __VLS_244;
        const __VLS_245 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_246 = __VLS_asFunctionalComponent(__VLS_245, new __VLS_245({
            value: "boolean",
        }));
        const __VLS_247 = __VLS_246({
            value: "boolean",
        }, ...__VLS_functionalComponentArgsRest(__VLS_246));
        __VLS_248.slots.default;
        var __VLS_248;
        var __VLS_232;
        const __VLS_249 = {}.ACheckbox;
        /** @type {[typeof __VLS_components.ACheckbox, typeof __VLS_components.aCheckbox, typeof __VLS_components.ACheckbox, typeof __VLS_components.aCheckbox, ]} */ ;
        // @ts-ignore
        const __VLS_250 = __VLS_asFunctionalComponent(__VLS_249, new __VLS_249({
            checked: (p.required),
        }));
        const __VLS_251 = __VLS_250({
            checked: (p.required),
        }, ...__VLS_functionalComponentArgsRest(__VLS_250));
        __VLS_252.slots.default;
        var __VLS_252;
        const __VLS_253 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_254 = __VLS_asFunctionalComponent(__VLS_253, new __VLS_253({
            value: (p.description),
            placeholder: "参数描述",
            size: "small",
            ...{ style: {} },
        }));
        const __VLS_255 = __VLS_254({
            value: (p.description),
            placeholder: "参数描述",
            size: "small",
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_254));
        const __VLS_257 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_258 = __VLS_asFunctionalComponent(__VLS_257, new __VLS_257({
            ...{ 'onClick': {} },
            size: "small",
            type: "link",
            danger: true,
        }));
        const __VLS_259 = __VLS_258({
            ...{ 'onClick': {} },
            size: "small",
            type: "link",
            danger: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_258));
        let __VLS_261;
        let __VLS_262;
        let __VLS_263;
        const __VLS_264 = {
            onClick: (...[$event]) => {
                __VLS_ctx.removeParam(tool, pi);
            }
        };
        __VLS_260.slots.default;
        var __VLS_260;
    }
    const __VLS_265 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_266 = __VLS_asFunctionalComponent(__VLS_265, new __VLS_265({
        ...{ 'onClick': {} },
        size: "small",
        type: "dashed",
        block: true,
    }));
    const __VLS_267 = __VLS_266({
        ...{ 'onClick': {} },
        size: "small",
        type: "dashed",
        block: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_266));
    let __VLS_269;
    let __VLS_270;
    let __VLS_271;
    const __VLS_272 = {
        onClick: (...[$event]) => {
            __VLS_ctx.addParam(tool);
        }
    };
    __VLS_268.slots.default;
    var __VLS_268;
}
const __VLS_273 = {}.AButton;
/** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
// @ts-ignore
const __VLS_274 = __VLS_asFunctionalComponent(__VLS_273, new __VLS_273({
    ...{ 'onClick': {} },
    type: "dashed",
    block: true,
}));
const __VLS_275 = __VLS_274({
    ...{ 'onClick': {} },
    type: "dashed",
    block: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_274));
let __VLS_277;
let __VLS_278;
let __VLS_279;
const __VLS_280 = {
    onClick: (__VLS_ctx.addTool)
};
__VLS_276.slots.default;
var __VLS_276;
var __VLS_72;
var __VLS_64;
const __VLS_281 = {}.AModal;
/** @type {[typeof __VLS_components.AModal, typeof __VLS_components.aModal, typeof __VLS_components.AModal, typeof __VLS_components.aModal, ]} */ ;
// @ts-ignore
const __VLS_282 = __VLS_asFunctionalComponent(__VLS_281, new __VLS_281({
    open: (__VLS_ctx.debugVisible),
    title: (`调试 ${__VLS_ctx.debugModule?.name ?? ''}`),
    width: "640px",
    footer: (null),
}));
const __VLS_283 = __VLS_282({
    open: (__VLS_ctx.debugVisible),
    title: (`调试 ${__VLS_ctx.debugModule?.name ?? ''}`),
    width: "640px",
    footer: (null),
}, ...__VLS_functionalComponentArgsRest(__VLS_282));
__VLS_284.slots.default;
const __VLS_285 = {}.AForm;
/** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
// @ts-ignore
const __VLS_286 = __VLS_asFunctionalComponent(__VLS_285, new __VLS_285({
    layout: "vertical",
}));
const __VLS_287 = __VLS_286({
    layout: "vertical",
}, ...__VLS_functionalComponentArgsRest(__VLS_286));
__VLS_288.slots.default;
const __VLS_289 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_290 = __VLS_asFunctionalComponent(__VLS_289, new __VLS_289({
    label: "选择工具",
}));
const __VLS_291 = __VLS_290({
    label: "选择工具",
}, ...__VLS_functionalComponentArgsRest(__VLS_290));
__VLS_292.slots.default;
const __VLS_293 = {}.ASelect;
/** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
// @ts-ignore
const __VLS_294 = __VLS_asFunctionalComponent(__VLS_293, new __VLS_293({
    value: (__VLS_ctx.debugTool),
}));
const __VLS_295 = __VLS_294({
    value: (__VLS_ctx.debugTool),
}, ...__VLS_functionalComponentArgsRest(__VLS_294));
__VLS_296.slots.default;
for (const [t] of __VLS_getVForSourceType((__VLS_ctx.debugModule?.tools ?? []))) {
    const __VLS_297 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_298 = __VLS_asFunctionalComponent(__VLS_297, new __VLS_297({
        key: (t.name),
        value: (t.name),
    }));
    const __VLS_299 = __VLS_298({
        key: (t.name),
        value: (t.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_298));
    __VLS_300.slots.default;
    (t.name);
    (t.method);
    (t.path);
    var __VLS_300;
}
var __VLS_296;
var __VLS_292;
for (const [p] of __VLS_getVForSourceType((__VLS_ctx.currentTool()?.params ?? []))) {
    const __VLS_301 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_302 = __VLS_asFunctionalComponent(__VLS_301, new __VLS_301({
        label: (`${p.name}${p.required ? ' *' : ''}`),
    }));
    const __VLS_303 = __VLS_302({
        label: (`${p.name}${p.required ? ' *' : ''}`),
    }, ...__VLS_functionalComponentArgsRest(__VLS_302));
    __VLS_304.slots.default;
    if (p.type === 'integer' || p.type === 'number') {
        const __VLS_305 = {}.AInputNumber;
        /** @type {[typeof __VLS_components.AInputNumber, typeof __VLS_components.aInputNumber, ]} */ ;
        // @ts-ignore
        const __VLS_306 = __VLS_asFunctionalComponent(__VLS_305, new __VLS_305({
            value: (__VLS_ctx.debugArgs[p.name]),
            ...{ style: {} },
        }));
        const __VLS_307 = __VLS_306({
            value: (__VLS_ctx.debugArgs[p.name]),
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_306));
    }
    else if (p.type === 'boolean') {
        const __VLS_309 = {}.ASwitch;
        /** @type {[typeof __VLS_components.ASwitch, typeof __VLS_components.aSwitch, ]} */ ;
        // @ts-ignore
        const __VLS_310 = __VLS_asFunctionalComponent(__VLS_309, new __VLS_309({
            checked: (__VLS_ctx.debugArgs[p.name]),
        }));
        const __VLS_311 = __VLS_310({
            checked: (__VLS_ctx.debugArgs[p.name]),
        }, ...__VLS_functionalComponentArgsRest(__VLS_310));
    }
    else {
        const __VLS_313 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_314 = __VLS_asFunctionalComponent(__VLS_313, new __VLS_313({
            value: (__VLS_ctx.debugArgs[p.name]),
            placeholder: (p.description),
        }));
        const __VLS_315 = __VLS_314({
            value: (__VLS_ctx.debugArgs[p.name]),
            placeholder: (p.description),
        }, ...__VLS_functionalComponentArgsRest(__VLS_314));
    }
    var __VLS_304;
}
const __VLS_317 = {}.AButton;
/** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
// @ts-ignore
const __VLS_318 = __VLS_asFunctionalComponent(__VLS_317, new __VLS_317({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.debugLoading),
}));
const __VLS_319 = __VLS_318({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.debugLoading),
}, ...__VLS_functionalComponentArgsRest(__VLS_318));
let __VLS_321;
let __VLS_322;
let __VLS_323;
const __VLS_324 = {
    onClick: (__VLS_ctx.runDebug)
};
__VLS_320.slots.default;
var __VLS_320;
var __VLS_288;
const __VLS_325 = {}.ADivider;
/** @type {[typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, ]} */ ;
// @ts-ignore
const __VLS_326 = __VLS_asFunctionalComponent(__VLS_325, new __VLS_325({}));
const __VLS_327 = __VLS_326({}, ...__VLS_functionalComponentArgsRest(__VLS_326));
__VLS_328.slots.default;
var __VLS_328;
__VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
    ...{ class: "result" },
});
(__VLS_ctx.debugResult || '（暂无结果）');
var __VLS_284;
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page']} */ ;
/** @type {__VLS_StyleScopedClasses['header']} */ ;
/** @type {__VLS_StyleScopedClasses['tool-card']} */ ;
/** @type {__VLS_StyleScopedClasses['param-list']} */ ;
/** @type {__VLS_StyleScopedClasses['param-row']} */ ;
/** @type {__VLS_StyleScopedClasses['result']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            antdTheme: antdTheme,
            modules: modules,
            loading: loading,
            editVisible: editVisible,
            editingId: editingId,
            editForm: editForm,
            debugVisible: debugVisible,
            debugModule: debugModule,
            debugTool: debugTool,
            debugArgs: debugArgs,
            debugResult: debugResult,
            debugLoading: debugLoading,
            openCreate: openCreate,
            openEdit: openEdit,
            addTool: addTool,
            removeTool: removeTool,
            addParam: addParam,
            removeParam: removeParam,
            submitEdit: submitEdit,
            onDelete: onDelete,
            onToggle: onToggle,
            openDebug: openDebug,
            currentTool: currentTool,
            runDebug: runDebug,
            columns: columns,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
