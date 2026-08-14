import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
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
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "page" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
    ...{ class: "header" },
});
__VLS_asFunctionalElement(__VLS_intrinsicElements.h2, __VLS_intrinsicElements.h2)({});
const __VLS_0 = {}.AButton;
/** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
// @ts-ignore
const __VLS_1 = __VLS_asFunctionalComponent(__VLS_0, new __VLS_0({
    ...{ 'onClick': {} },
    type: "primary",
}));
const __VLS_2 = __VLS_1({
    ...{ 'onClick': {} },
    type: "primary",
}, ...__VLS_functionalComponentArgsRest(__VLS_1));
let __VLS_4;
let __VLS_5;
let __VLS_6;
const __VLS_7 = {
    onClick: (__VLS_ctx.openCreate)
};
__VLS_3.slots.default;
var __VLS_3;
const __VLS_8 = {}.ATable;
/** @type {[typeof __VLS_components.ATable, typeof __VLS_components.aTable, typeof __VLS_components.ATable, typeof __VLS_components.aTable, ]} */ ;
// @ts-ignore
const __VLS_9 = __VLS_asFunctionalComponent(__VLS_8, new __VLS_8({
    columns: (__VLS_ctx.columns),
    dataSource: (__VLS_ctx.modules),
    loading: (__VLS_ctx.loading),
    rowKey: "id",
    pagination: (false),
    size: "middle",
}));
const __VLS_10 = __VLS_9({
    columns: (__VLS_ctx.columns),
    dataSource: (__VLS_ctx.modules),
    loading: (__VLS_ctx.loading),
    rowKey: "id",
    pagination: (false),
    size: "middle",
}, ...__VLS_functionalComponentArgsRest(__VLS_9));
__VLS_11.slots.default;
{
    const { bodyCell: __VLS_thisSlot } = __VLS_11.slots;
    const [{ column, record }] = __VLS_getSlotParams(__VLS_thisSlot);
    if (column.key === 'toolCount') {
        const __VLS_12 = {}.ATag;
        /** @type {[typeof __VLS_components.ATag, typeof __VLS_components.aTag, typeof __VLS_components.ATag, typeof __VLS_components.aTag, ]} */ ;
        // @ts-ignore
        const __VLS_13 = __VLS_asFunctionalComponent(__VLS_12, new __VLS_12({
            color: "blue",
        }));
        const __VLS_14 = __VLS_13({
            color: "blue",
        }, ...__VLS_functionalComponentArgsRest(__VLS_13));
        __VLS_15.slots.default;
        (record.tools?.length ?? 0);
        var __VLS_15;
    }
    else if (column.key === 'enabled') {
        const __VLS_16 = {}.ASwitch;
        /** @type {[typeof __VLS_components.ASwitch, typeof __VLS_components.aSwitch, ]} */ ;
        // @ts-ignore
        const __VLS_17 = __VLS_asFunctionalComponent(__VLS_16, new __VLS_16({
            ...{ 'onChange': {} },
            checked: (record.enabled === 1),
        }));
        const __VLS_18 = __VLS_17({
            ...{ 'onChange': {} },
            checked: (record.enabled === 1),
        }, ...__VLS_functionalComponentArgsRest(__VLS_17));
        let __VLS_20;
        let __VLS_21;
        let __VLS_22;
        const __VLS_23 = {
            onChange: ((checked) => __VLS_ctx.onToggle(record, checked))
        };
        var __VLS_19;
    }
    else if (column.key === 'action') {
        const __VLS_24 = {}.ASpace;
        /** @type {[typeof __VLS_components.ASpace, typeof __VLS_components.aSpace, typeof __VLS_components.ASpace, typeof __VLS_components.aSpace, ]} */ ;
        // @ts-ignore
        const __VLS_25 = __VLS_asFunctionalComponent(__VLS_24, new __VLS_24({}));
        const __VLS_26 = __VLS_25({}, ...__VLS_functionalComponentArgsRest(__VLS_25));
        __VLS_27.slots.default;
        const __VLS_28 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_29 = __VLS_asFunctionalComponent(__VLS_28, new __VLS_28({
            ...{ 'onClick': {} },
            size: "small",
        }));
        const __VLS_30 = __VLS_29({
            ...{ 'onClick': {} },
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_29));
        let __VLS_32;
        let __VLS_33;
        let __VLS_34;
        const __VLS_35 = {
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
        __VLS_31.slots.default;
        var __VLS_31;
        const __VLS_36 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_37 = __VLS_asFunctionalComponent(__VLS_36, new __VLS_36({
            ...{ 'onClick': {} },
            size: "small",
        }));
        const __VLS_38 = __VLS_37({
            ...{ 'onClick': {} },
            size: "small",
        }, ...__VLS_functionalComponentArgsRest(__VLS_37));
        let __VLS_40;
        let __VLS_41;
        let __VLS_42;
        const __VLS_43 = {
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
        __VLS_39.slots.default;
        var __VLS_39;
        const __VLS_44 = {}.APopconfirm;
        /** @type {[typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, ]} */ ;
        // @ts-ignore
        const __VLS_45 = __VLS_asFunctionalComponent(__VLS_44, new __VLS_44({
            ...{ 'onConfirm': {} },
            title: "确定删除该模块？",
        }));
        const __VLS_46 = __VLS_45({
            ...{ 'onConfirm': {} },
            title: "确定删除该模块？",
        }, ...__VLS_functionalComponentArgsRest(__VLS_45));
        let __VLS_48;
        let __VLS_49;
        let __VLS_50;
        const __VLS_51 = {
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
        __VLS_47.slots.default;
        const __VLS_52 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_53 = __VLS_asFunctionalComponent(__VLS_52, new __VLS_52({
            size: "small",
            danger: true,
        }));
        const __VLS_54 = __VLS_53({
            size: "small",
            danger: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_53));
        __VLS_55.slots.default;
        var __VLS_55;
        var __VLS_47;
        var __VLS_27;
    }
}
var __VLS_11;
const __VLS_56 = {}.AModal;
/** @type {[typeof __VLS_components.AModal, typeof __VLS_components.aModal, typeof __VLS_components.AModal, typeof __VLS_components.aModal, ]} */ ;
// @ts-ignore
const __VLS_57 = __VLS_asFunctionalComponent(__VLS_56, new __VLS_56({
    ...{ 'onOk': {} },
    open: (__VLS_ctx.editVisible),
    title: (__VLS_ctx.editingId ? '编辑模块' : '添加模块'),
    width: "760px",
}));
const __VLS_58 = __VLS_57({
    ...{ 'onOk': {} },
    open: (__VLS_ctx.editVisible),
    title: (__VLS_ctx.editingId ? '编辑模块' : '添加模块'),
    width: "760px",
}, ...__VLS_functionalComponentArgsRest(__VLS_57));
let __VLS_60;
let __VLS_61;
let __VLS_62;
const __VLS_63 = {
    onOk: (__VLS_ctx.submitEdit)
};
__VLS_59.slots.default;
const __VLS_64 = {}.AForm;
/** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
// @ts-ignore
const __VLS_65 = __VLS_asFunctionalComponent(__VLS_64, new __VLS_64({
    layout: "vertical",
}));
const __VLS_66 = __VLS_65({
    layout: "vertical",
}, ...__VLS_functionalComponentArgsRest(__VLS_65));
__VLS_67.slots.default;
const __VLS_68 = {}.ARow;
/** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
// @ts-ignore
const __VLS_69 = __VLS_asFunctionalComponent(__VLS_68, new __VLS_68({
    gutter: (16),
}));
const __VLS_70 = __VLS_69({
    gutter: (16),
}, ...__VLS_functionalComponentArgsRest(__VLS_69));
__VLS_71.slots.default;
const __VLS_72 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_73 = __VLS_asFunctionalComponent(__VLS_72, new __VLS_72({
    span: (12),
}));
const __VLS_74 = __VLS_73({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_73));
__VLS_75.slots.default;
const __VLS_76 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_77 = __VLS_asFunctionalComponent(__VLS_76, new __VLS_76({
    label: "模块名",
    required: true,
}));
const __VLS_78 = __VLS_77({
    label: "模块名",
    required: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_77));
__VLS_79.slots.default;
const __VLS_80 = {}.AInput;
/** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
// @ts-ignore
const __VLS_81 = __VLS_asFunctionalComponent(__VLS_80, new __VLS_80({
    value: (__VLS_ctx.editForm.name),
    placeholder: "如：用户服务",
}));
const __VLS_82 = __VLS_81({
    value: (__VLS_ctx.editForm.name),
    placeholder: "如：用户服务",
}, ...__VLS_functionalComponentArgsRest(__VLS_81));
var __VLS_79;
var __VLS_75;
const __VLS_84 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_85 = __VLS_asFunctionalComponent(__VLS_84, new __VLS_84({
    span: (12),
}));
const __VLS_86 = __VLS_85({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_85));
__VLS_87.slots.default;
const __VLS_88 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_89 = __VLS_asFunctionalComponent(__VLS_88, new __VLS_88({
    label: "描述",
}));
const __VLS_90 = __VLS_89({
    label: "描述",
}, ...__VLS_functionalComponentArgsRest(__VLS_89));
__VLS_91.slots.default;
const __VLS_92 = {}.AInput;
/** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
// @ts-ignore
const __VLS_93 = __VLS_asFunctionalComponent(__VLS_92, new __VLS_92({
    value: (__VLS_ctx.editForm.description),
}));
const __VLS_94 = __VLS_93({
    value: (__VLS_ctx.editForm.description),
}, ...__VLS_functionalComponentArgsRest(__VLS_93));
var __VLS_91;
var __VLS_87;
var __VLS_71;
const __VLS_96 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_97 = __VLS_asFunctionalComponent(__VLS_96, new __VLS_96({
    label: "服务地址 base_url",
    required: true,
}));
const __VLS_98 = __VLS_97({
    label: "服务地址 base_url",
    required: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_97));
__VLS_99.slots.default;
const __VLS_100 = {}.AInput;
/** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
// @ts-ignore
const __VLS_101 = __VLS_asFunctionalComponent(__VLS_100, new __VLS_100({
    value: (__VLS_ctx.editForm.base_url),
    placeholder: "http://172.16.16.10:8080",
}));
const __VLS_102 = __VLS_101({
    value: (__VLS_ctx.editForm.base_url),
    placeholder: "http://172.16.16.10:8080",
}, ...__VLS_functionalComponentArgsRest(__VLS_101));
var __VLS_99;
const __VLS_104 = {}.ARow;
/** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
// @ts-ignore
const __VLS_105 = __VLS_asFunctionalComponent(__VLS_104, new __VLS_104({
    gutter: (16),
}));
const __VLS_106 = __VLS_105({
    gutter: (16),
}, ...__VLS_functionalComponentArgsRest(__VLS_105));
__VLS_107.slots.default;
const __VLS_108 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_109 = __VLS_asFunctionalComponent(__VLS_108, new __VLS_108({
    span: (12),
}));
const __VLS_110 = __VLS_109({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_109));
__VLS_111.slots.default;
const __VLS_112 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_113 = __VLS_asFunctionalComponent(__VLS_112, new __VLS_112({
    label: "超时（秒）",
}));
const __VLS_114 = __VLS_113({
    label: "超时（秒）",
}, ...__VLS_functionalComponentArgsRest(__VLS_113));
__VLS_115.slots.default;
const __VLS_116 = {}.AInputNumber;
/** @type {[typeof __VLS_components.AInputNumber, typeof __VLS_components.aInputNumber, ]} */ ;
// @ts-ignore
const __VLS_117 = __VLS_asFunctionalComponent(__VLS_116, new __VLS_116({
    value: (__VLS_ctx.editForm.timeout),
    min: (1),
    ...{ style: {} },
}));
const __VLS_118 = __VLS_117({
    value: (__VLS_ctx.editForm.timeout),
    min: (1),
    ...{ style: {} },
}, ...__VLS_functionalComponentArgsRest(__VLS_117));
var __VLS_115;
var __VLS_111;
const __VLS_120 = {}.ACol;
/** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
// @ts-ignore
const __VLS_121 = __VLS_asFunctionalComponent(__VLS_120, new __VLS_120({
    span: (12),
}));
const __VLS_122 = __VLS_121({
    span: (12),
}, ...__VLS_functionalComponentArgsRest(__VLS_121));
__VLS_123.slots.default;
const __VLS_124 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_125 = __VLS_asFunctionalComponent(__VLS_124, new __VLS_124({
    label: "鉴权类型",
}));
const __VLS_126 = __VLS_125({
    label: "鉴权类型",
}, ...__VLS_functionalComponentArgsRest(__VLS_125));
__VLS_127.slots.default;
const __VLS_128 = {}.ASelect;
/** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
// @ts-ignore
const __VLS_129 = __VLS_asFunctionalComponent(__VLS_128, new __VLS_128({
    value: (__VLS_ctx.editForm.auth_type),
    placeholder: "无鉴权",
}));
const __VLS_130 = __VLS_129({
    value: (__VLS_ctx.editForm.auth_type),
    placeholder: "无鉴权",
}, ...__VLS_functionalComponentArgsRest(__VLS_129));
__VLS_131.slots.default;
const __VLS_132 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_133 = __VLS_asFunctionalComponent(__VLS_132, new __VLS_132({
    value: "",
}));
const __VLS_134 = __VLS_133({
    value: "",
}, ...__VLS_functionalComponentArgsRest(__VLS_133));
__VLS_135.slots.default;
var __VLS_135;
const __VLS_136 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_137 = __VLS_asFunctionalComponent(__VLS_136, new __VLS_136({
    value: "bearer",
}));
const __VLS_138 = __VLS_137({
    value: "bearer",
}, ...__VLS_functionalComponentArgsRest(__VLS_137));
__VLS_139.slots.default;
var __VLS_139;
const __VLS_140 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_141 = __VLS_asFunctionalComponent(__VLS_140, new __VLS_140({
    value: "basic",
}));
const __VLS_142 = __VLS_141({
    value: "basic",
}, ...__VLS_functionalComponentArgsRest(__VLS_141));
__VLS_143.slots.default;
var __VLS_143;
const __VLS_144 = {}.ASelectOption;
/** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
// @ts-ignore
const __VLS_145 = __VLS_asFunctionalComponent(__VLS_144, new __VLS_144({
    value: "header",
}));
const __VLS_146 = __VLS_145({
    value: "header",
}, ...__VLS_functionalComponentArgsRest(__VLS_145));
__VLS_147.slots.default;
var __VLS_147;
var __VLS_131;
var __VLS_127;
var __VLS_123;
var __VLS_107;
const __VLS_148 = {}.ADivider;
/** @type {[typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, ]} */ ;
// @ts-ignore
const __VLS_149 = __VLS_asFunctionalComponent(__VLS_148, new __VLS_148({}));
const __VLS_150 = __VLS_149({}, ...__VLS_functionalComponentArgsRest(__VLS_149));
__VLS_151.slots.default;
var __VLS_151;
for (const [tool, ti] of __VLS_getVForSourceType((__VLS_ctx.editForm.tools))) {
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        key: (ti),
        ...{ class: "tool-card" },
    });
    const __VLS_152 = {}.ARow;
    /** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
    // @ts-ignore
    const __VLS_153 = __VLS_asFunctionalComponent(__VLS_152, new __VLS_152({
        gutter: (8),
    }));
    const __VLS_154 = __VLS_153({
        gutter: (8),
    }, ...__VLS_functionalComponentArgsRest(__VLS_153));
    __VLS_155.slots.default;
    const __VLS_156 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_157 = __VLS_asFunctionalComponent(__VLS_156, new __VLS_156({
        span: (6),
    }));
    const __VLS_158 = __VLS_157({
        span: (6),
    }, ...__VLS_functionalComponentArgsRest(__VLS_157));
    __VLS_159.slots.default;
    const __VLS_160 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_161 = __VLS_asFunctionalComponent(__VLS_160, new __VLS_160({
        value: (tool.name),
        placeholder: "工具名",
    }));
    const __VLS_162 = __VLS_161({
        value: (tool.name),
        placeholder: "工具名",
    }, ...__VLS_functionalComponentArgsRest(__VLS_161));
    var __VLS_159;
    const __VLS_164 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_165 = __VLS_asFunctionalComponent(__VLS_164, new __VLS_164({
        span: (5),
    }));
    const __VLS_166 = __VLS_165({
        span: (5),
    }, ...__VLS_functionalComponentArgsRest(__VLS_165));
    __VLS_167.slots.default;
    const __VLS_168 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_169 = __VLS_asFunctionalComponent(__VLS_168, new __VLS_168({
        value: (tool.description),
        placeholder: "描述",
    }));
    const __VLS_170 = __VLS_169({
        value: (tool.description),
        placeholder: "描述",
    }, ...__VLS_functionalComponentArgsRest(__VLS_169));
    var __VLS_167;
    const __VLS_172 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_173 = __VLS_asFunctionalComponent(__VLS_172, new __VLS_172({
        span: (4),
    }));
    const __VLS_174 = __VLS_173({
        span: (4),
    }, ...__VLS_functionalComponentArgsRest(__VLS_173));
    __VLS_175.slots.default;
    const __VLS_176 = {}.ASelect;
    /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
    // @ts-ignore
    const __VLS_177 = __VLS_asFunctionalComponent(__VLS_176, new __VLS_176({
        value: (tool.method),
    }));
    const __VLS_178 = __VLS_177({
        value: (tool.method),
    }, ...__VLS_functionalComponentArgsRest(__VLS_177));
    __VLS_179.slots.default;
    const __VLS_180 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_181 = __VLS_asFunctionalComponent(__VLS_180, new __VLS_180({
        value: "GET",
    }));
    const __VLS_182 = __VLS_181({
        value: "GET",
    }, ...__VLS_functionalComponentArgsRest(__VLS_181));
    __VLS_183.slots.default;
    var __VLS_183;
    const __VLS_184 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_185 = __VLS_asFunctionalComponent(__VLS_184, new __VLS_184({
        value: "POST",
    }));
    const __VLS_186 = __VLS_185({
        value: "POST",
    }, ...__VLS_functionalComponentArgsRest(__VLS_185));
    __VLS_187.slots.default;
    var __VLS_187;
    const __VLS_188 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_189 = __VLS_asFunctionalComponent(__VLS_188, new __VLS_188({
        value: "PUT",
    }));
    const __VLS_190 = __VLS_189({
        value: "PUT",
    }, ...__VLS_functionalComponentArgsRest(__VLS_189));
    __VLS_191.slots.default;
    var __VLS_191;
    const __VLS_192 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_193 = __VLS_asFunctionalComponent(__VLS_192, new __VLS_192({
        value: "PATCH",
    }));
    const __VLS_194 = __VLS_193({
        value: "PATCH",
    }, ...__VLS_functionalComponentArgsRest(__VLS_193));
    __VLS_195.slots.default;
    var __VLS_195;
    const __VLS_196 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_197 = __VLS_asFunctionalComponent(__VLS_196, new __VLS_196({
        value: "DELETE",
    }));
    const __VLS_198 = __VLS_197({
        value: "DELETE",
    }, ...__VLS_functionalComponentArgsRest(__VLS_197));
    __VLS_199.slots.default;
    var __VLS_199;
    var __VLS_179;
    var __VLS_175;
    const __VLS_200 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_201 = __VLS_asFunctionalComponent(__VLS_200, new __VLS_200({
        span: (6),
    }));
    const __VLS_202 = __VLS_201({
        span: (6),
    }, ...__VLS_functionalComponentArgsRest(__VLS_201));
    __VLS_203.slots.default;
    const __VLS_204 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_205 = __VLS_asFunctionalComponent(__VLS_204, new __VLS_204({
        value: (tool.path),
        placeholder: "/api/xxx/{id}",
    }));
    const __VLS_206 = __VLS_205({
        value: (tool.path),
        placeholder: "/api/xxx/{id}",
    }, ...__VLS_functionalComponentArgsRest(__VLS_205));
    var __VLS_203;
    const __VLS_208 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_209 = __VLS_asFunctionalComponent(__VLS_208, new __VLS_208({
        span: (3),
    }));
    const __VLS_210 = __VLS_209({
        span: (3),
    }, ...__VLS_functionalComponentArgsRest(__VLS_209));
    __VLS_211.slots.default;
    const __VLS_212 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_213 = __VLS_asFunctionalComponent(__VLS_212, new __VLS_212({
        ...{ 'onClick': {} },
        size: "small",
        danger: true,
    }));
    const __VLS_214 = __VLS_213({
        ...{ 'onClick': {} },
        size: "small",
        danger: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_213));
    let __VLS_216;
    let __VLS_217;
    let __VLS_218;
    const __VLS_219 = {
        onClick: (...[$event]) => {
            __VLS_ctx.removeTool(ti);
        }
    };
    __VLS_215.slots.default;
    var __VLS_215;
    var __VLS_211;
    var __VLS_155;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
        ...{ class: "param-list" },
    });
    for (const [p, pi] of __VLS_getVForSourceType((tool.params))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (pi),
            ...{ class: "param-row" },
        });
        const __VLS_220 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_221 = __VLS_asFunctionalComponent(__VLS_220, new __VLS_220({
            value: (p.name),
            placeholder: "参数名",
            size: "small",
            ...{ style: {} },
        }));
        const __VLS_222 = __VLS_221({
            value: (p.name),
            placeholder: "参数名",
            size: "small",
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_221));
        const __VLS_224 = {}.ASelect;
        /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
        // @ts-ignore
        const __VLS_225 = __VLS_asFunctionalComponent(__VLS_224, new __VLS_224({
            value: (p.type),
            size: "small",
            ...{ style: {} },
        }));
        const __VLS_226 = __VLS_225({
            value: (p.type),
            size: "small",
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_225));
        __VLS_227.slots.default;
        const __VLS_228 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_229 = __VLS_asFunctionalComponent(__VLS_228, new __VLS_228({
            value: "string",
        }));
        const __VLS_230 = __VLS_229({
            value: "string",
        }, ...__VLS_functionalComponentArgsRest(__VLS_229));
        __VLS_231.slots.default;
        var __VLS_231;
        const __VLS_232 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_233 = __VLS_asFunctionalComponent(__VLS_232, new __VLS_232({
            value: "integer",
        }));
        const __VLS_234 = __VLS_233({
            value: "integer",
        }, ...__VLS_functionalComponentArgsRest(__VLS_233));
        __VLS_235.slots.default;
        var __VLS_235;
        const __VLS_236 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_237 = __VLS_asFunctionalComponent(__VLS_236, new __VLS_236({
            value: "number",
        }));
        const __VLS_238 = __VLS_237({
            value: "number",
        }, ...__VLS_functionalComponentArgsRest(__VLS_237));
        __VLS_239.slots.default;
        var __VLS_239;
        const __VLS_240 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_241 = __VLS_asFunctionalComponent(__VLS_240, new __VLS_240({
            value: "boolean",
        }));
        const __VLS_242 = __VLS_241({
            value: "boolean",
        }, ...__VLS_functionalComponentArgsRest(__VLS_241));
        __VLS_243.slots.default;
        var __VLS_243;
        var __VLS_227;
        const __VLS_244 = {}.ACheckbox;
        /** @type {[typeof __VLS_components.ACheckbox, typeof __VLS_components.aCheckbox, typeof __VLS_components.ACheckbox, typeof __VLS_components.aCheckbox, ]} */ ;
        // @ts-ignore
        const __VLS_245 = __VLS_asFunctionalComponent(__VLS_244, new __VLS_244({
            checked: (p.required),
        }));
        const __VLS_246 = __VLS_245({
            checked: (p.required),
        }, ...__VLS_functionalComponentArgsRest(__VLS_245));
        __VLS_247.slots.default;
        var __VLS_247;
        const __VLS_248 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_249 = __VLS_asFunctionalComponent(__VLS_248, new __VLS_248({
            value: (p.description),
            placeholder: "参数描述",
            size: "small",
            ...{ style: {} },
        }));
        const __VLS_250 = __VLS_249({
            value: (p.description),
            placeholder: "参数描述",
            size: "small",
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_249));
        const __VLS_252 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_253 = __VLS_asFunctionalComponent(__VLS_252, new __VLS_252({
            ...{ 'onClick': {} },
            size: "small",
            type: "link",
            danger: true,
        }));
        const __VLS_254 = __VLS_253({
            ...{ 'onClick': {} },
            size: "small",
            type: "link",
            danger: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_253));
        let __VLS_256;
        let __VLS_257;
        let __VLS_258;
        const __VLS_259 = {
            onClick: (...[$event]) => {
                __VLS_ctx.removeParam(tool, pi);
            }
        };
        __VLS_255.slots.default;
        var __VLS_255;
    }
    const __VLS_260 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_261 = __VLS_asFunctionalComponent(__VLS_260, new __VLS_260({
        ...{ 'onClick': {} },
        size: "small",
        type: "dashed",
        block: true,
    }));
    const __VLS_262 = __VLS_261({
        ...{ 'onClick': {} },
        size: "small",
        type: "dashed",
        block: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_261));
    let __VLS_264;
    let __VLS_265;
    let __VLS_266;
    const __VLS_267 = {
        onClick: (...[$event]) => {
            __VLS_ctx.addParam(tool);
        }
    };
    __VLS_263.slots.default;
    var __VLS_263;
}
const __VLS_268 = {}.AButton;
/** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
// @ts-ignore
const __VLS_269 = __VLS_asFunctionalComponent(__VLS_268, new __VLS_268({
    ...{ 'onClick': {} },
    type: "dashed",
    block: true,
}));
const __VLS_270 = __VLS_269({
    ...{ 'onClick': {} },
    type: "dashed",
    block: true,
}, ...__VLS_functionalComponentArgsRest(__VLS_269));
let __VLS_272;
let __VLS_273;
let __VLS_274;
const __VLS_275 = {
    onClick: (__VLS_ctx.addTool)
};
__VLS_271.slots.default;
var __VLS_271;
var __VLS_67;
var __VLS_59;
const __VLS_276 = {}.AModal;
/** @type {[typeof __VLS_components.AModal, typeof __VLS_components.aModal, typeof __VLS_components.AModal, typeof __VLS_components.aModal, ]} */ ;
// @ts-ignore
const __VLS_277 = __VLS_asFunctionalComponent(__VLS_276, new __VLS_276({
    open: (__VLS_ctx.debugVisible),
    title: (`调试 ${__VLS_ctx.debugModule?.name ?? ''}`),
    width: "640px",
    footer: (null),
}));
const __VLS_278 = __VLS_277({
    open: (__VLS_ctx.debugVisible),
    title: (`调试 ${__VLS_ctx.debugModule?.name ?? ''}`),
    width: "640px",
    footer: (null),
}, ...__VLS_functionalComponentArgsRest(__VLS_277));
__VLS_279.slots.default;
const __VLS_280 = {}.AForm;
/** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
// @ts-ignore
const __VLS_281 = __VLS_asFunctionalComponent(__VLS_280, new __VLS_280({
    layout: "vertical",
}));
const __VLS_282 = __VLS_281({
    layout: "vertical",
}, ...__VLS_functionalComponentArgsRest(__VLS_281));
__VLS_283.slots.default;
const __VLS_284 = {}.AFormItem;
/** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
// @ts-ignore
const __VLS_285 = __VLS_asFunctionalComponent(__VLS_284, new __VLS_284({
    label: "选择工具",
}));
const __VLS_286 = __VLS_285({
    label: "选择工具",
}, ...__VLS_functionalComponentArgsRest(__VLS_285));
__VLS_287.slots.default;
const __VLS_288 = {}.ASelect;
/** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
// @ts-ignore
const __VLS_289 = __VLS_asFunctionalComponent(__VLS_288, new __VLS_288({
    value: (__VLS_ctx.debugTool),
}));
const __VLS_290 = __VLS_289({
    value: (__VLS_ctx.debugTool),
}, ...__VLS_functionalComponentArgsRest(__VLS_289));
__VLS_291.slots.default;
for (const [t] of __VLS_getVForSourceType((__VLS_ctx.debugModule?.tools ?? []))) {
    const __VLS_292 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_293 = __VLS_asFunctionalComponent(__VLS_292, new __VLS_292({
        key: (t.name),
        value: (t.name),
    }));
    const __VLS_294 = __VLS_293({
        key: (t.name),
        value: (t.name),
    }, ...__VLS_functionalComponentArgsRest(__VLS_293));
    __VLS_295.slots.default;
    (t.name);
    (t.method);
    (t.path);
    var __VLS_295;
}
var __VLS_291;
var __VLS_287;
for (const [p] of __VLS_getVForSourceType((__VLS_ctx.currentTool()?.params ?? []))) {
    const __VLS_296 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_297 = __VLS_asFunctionalComponent(__VLS_296, new __VLS_296({
        label: (`${p.name}${p.required ? ' *' : ''}`),
    }));
    const __VLS_298 = __VLS_297({
        label: (`${p.name}${p.required ? ' *' : ''}`),
    }, ...__VLS_functionalComponentArgsRest(__VLS_297));
    __VLS_299.slots.default;
    if (p.type === 'integer' || p.type === 'number') {
        const __VLS_300 = {}.AInputNumber;
        /** @type {[typeof __VLS_components.AInputNumber, typeof __VLS_components.aInputNumber, ]} */ ;
        // @ts-ignore
        const __VLS_301 = __VLS_asFunctionalComponent(__VLS_300, new __VLS_300({
            value: (__VLS_ctx.debugArgs[p.name]),
            ...{ style: {} },
        }));
        const __VLS_302 = __VLS_301({
            value: (__VLS_ctx.debugArgs[p.name]),
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_301));
    }
    else if (p.type === 'boolean') {
        const __VLS_304 = {}.ASwitch;
        /** @type {[typeof __VLS_components.ASwitch, typeof __VLS_components.aSwitch, ]} */ ;
        // @ts-ignore
        const __VLS_305 = __VLS_asFunctionalComponent(__VLS_304, new __VLS_304({
            checked: (__VLS_ctx.debugArgs[p.name]),
        }));
        const __VLS_306 = __VLS_305({
            checked: (__VLS_ctx.debugArgs[p.name]),
        }, ...__VLS_functionalComponentArgsRest(__VLS_305));
    }
    else {
        const __VLS_308 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_309 = __VLS_asFunctionalComponent(__VLS_308, new __VLS_308({
            value: (__VLS_ctx.debugArgs[p.name]),
            placeholder: (p.description),
        }));
        const __VLS_310 = __VLS_309({
            value: (__VLS_ctx.debugArgs[p.name]),
            placeholder: (p.description),
        }, ...__VLS_functionalComponentArgsRest(__VLS_309));
    }
    var __VLS_299;
}
const __VLS_312 = {}.AButton;
/** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
// @ts-ignore
const __VLS_313 = __VLS_asFunctionalComponent(__VLS_312, new __VLS_312({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.debugLoading),
}));
const __VLS_314 = __VLS_313({
    ...{ 'onClick': {} },
    type: "primary",
    loading: (__VLS_ctx.debugLoading),
}, ...__VLS_functionalComponentArgsRest(__VLS_313));
let __VLS_316;
let __VLS_317;
let __VLS_318;
const __VLS_319 = {
    onClick: (__VLS_ctx.runDebug)
};
__VLS_315.slots.default;
var __VLS_315;
var __VLS_283;
const __VLS_320 = {}.ADivider;
/** @type {[typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, ]} */ ;
// @ts-ignore
const __VLS_321 = __VLS_asFunctionalComponent(__VLS_320, new __VLS_320({}));
const __VLS_322 = __VLS_321({}, ...__VLS_functionalComponentArgsRest(__VLS_321));
__VLS_323.slots.default;
var __VLS_323;
__VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
    ...{ class: "result" },
});
(__VLS_ctx.debugResult || '（暂无结果）');
var __VLS_279;
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
