import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { antdTheme } from '@web-system/ui';
import { listModules, createModule, updateModule, deleteModule, toggleModule, debugCall, applyKey, verifyKey, listKeys, revokeKey, } from './api';
// ── Tab ──
const activeTab = ref('modules');
// ── 模块管理 ──
const modules = ref([]);
const loading = ref(false);
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
const debugVisible = ref(false);
const debugModule = ref(null);
const debugTool = ref('');
const debugArgs = reactive({});
const debugResult = ref('');
const debugLoading = ref(false);
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
async function onDelete(m) {
    await deleteModule(m.id);
    message.success('已删除');
    load();
}
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
const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '模块名', dataIndex: 'name', width: 160 },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '服务地址', dataIndex: 'base_url', ellipsis: true },
    { title: '工具数', key: 'toolCount', width: 80 },
    { title: '状态', key: 'enabled', width: 80 },
    { title: '操作', key: 'action', width: 220 },
];
// ── API Key 申请 ──
const applyEmail = ref('');
const applyLoading = ref(false);
const code = ref('');
const keyName = ref('');
const keyResult = ref('');
const applyMsg = ref('');
async function onApply() {
    if (!applyEmail.value) {
        message.warning('请填写邮箱');
        return;
    }
    applyLoading.value = true;
    applyMsg.value = '';
    try {
        await applyKey(applyEmail.value);
        applyMsg.value = '验证码已发送到邮箱，请查收（10 分钟内有效）';
        message.success('验证码已发送');
    }
    catch (e) {
        message.error(e?.response?.data?.message || e.message || '发送失败');
    }
    finally {
        applyLoading.value = false;
    }
}
async function onVerify() {
    if (!code.value) {
        message.warning('请填写验证码');
        return;
    }
    try {
        const r = await verifyKey(applyEmail.value, code.value, keyName.value);
        keyResult.value = r.key;
        message.success('Key 已生成，请复制保存');
    }
    catch (e) {
        message.error(e?.response?.data?.message || e.message || '验证失败');
    }
}
function copyKey() {
    navigator.clipboard?.writeText(keyResult.value);
    message.success('已复制到剪贴板');
}
// ── API Key 管理（运营）──
const adminKey = ref('');
const keys = ref([]);
const adminLoading = ref(false);
async function loadKeys() {
    if (!adminKey.value) {
        message.warning('请输入管理员密钥');
        return;
    }
    adminLoading.value = true;
    try {
        keys.value = await listKeys(adminKey.value);
    }
    catch (e) {
        message.error(e?.response?.data?.error || e.message || '加载失败');
    }
    finally {
        adminLoading.value = false;
    }
}
async function onRevoke(id) {
    try {
        await revokeKey(id, adminKey.value);
        message.success('已吊销');
        loadKeys();
    }
    catch (e) {
        message.error(e?.response?.data?.error || e.message || '吊销失败');
    }
}
const keyColumns = [
    { title: '前缀', dataIndex: 'keyPrefix', width: 120 },
    { title: '邮箱', dataIndex: 'email', ellipsis: true },
    { title: '名称', dataIndex: 'name', width: 120 },
    { title: '状态', dataIndex: 'status', width: 80 },
    { title: '来源', dataIndex: 'ownerType', width: 80 },
    { title: '最近使用', dataIndex: 'lastUsedAt', width: 160 },
    { title: '创建时间', dataIndex: 'createdAt', width: 160 },
    { title: '操作', key: 'action', width: 80 },
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
const __VLS_5 = {}.ARadioGroup;
/** @type {[typeof __VLS_components.ARadioGroup, typeof __VLS_components.aRadioGroup, typeof __VLS_components.ARadioGroup, typeof __VLS_components.aRadioGroup, ]} */ ;
// @ts-ignore
const __VLS_6 = __VLS_asFunctionalComponent(__VLS_5, new __VLS_5({
    value: (__VLS_ctx.activeTab),
}));
const __VLS_7 = __VLS_6({
    value: (__VLS_ctx.activeTab),
}, ...__VLS_functionalComponentArgsRest(__VLS_6));
__VLS_8.slots.default;
const __VLS_9 = {}.ARadioButton;
/** @type {[typeof __VLS_components.ARadioButton, typeof __VLS_components.aRadioButton, typeof __VLS_components.ARadioButton, typeof __VLS_components.aRadioButton, ]} */ ;
// @ts-ignore
const __VLS_10 = __VLS_asFunctionalComponent(__VLS_9, new __VLS_9({
    value: "modules",
}));
const __VLS_11 = __VLS_10({
    value: "modules",
}, ...__VLS_functionalComponentArgsRest(__VLS_10));
__VLS_12.slots.default;
var __VLS_12;
const __VLS_13 = {}.ARadioButton;
/** @type {[typeof __VLS_components.ARadioButton, typeof __VLS_components.aRadioButton, typeof __VLS_components.ARadioButton, typeof __VLS_components.aRadioButton, ]} */ ;
// @ts-ignore
const __VLS_14 = __VLS_asFunctionalComponent(__VLS_13, new __VLS_13({
    value: "keys",
}));
const __VLS_15 = __VLS_14({
    value: "keys",
}, ...__VLS_functionalComponentArgsRest(__VLS_14));
__VLS_16.slots.default;
var __VLS_16;
var __VLS_8;
if (__VLS_ctx.activeTab === 'modules') {
    const __VLS_17 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_18 = __VLS_asFunctionalComponent(__VLS_17, new __VLS_17({
        ...{ 'onClick': {} },
        type: "primary",
    }));
    const __VLS_19 = __VLS_18({
        ...{ 'onClick': {} },
        type: "primary",
    }, ...__VLS_functionalComponentArgsRest(__VLS_18));
    let __VLS_21;
    let __VLS_22;
    let __VLS_23;
    const __VLS_24 = {
        onClick: (__VLS_ctx.openCreate)
    };
    __VLS_20.slots.default;
    var __VLS_20;
}
if (__VLS_ctx.activeTab === 'modules') {
    const __VLS_25 = {}.ATable;
    /** @type {[typeof __VLS_components.ATable, typeof __VLS_components.aTable, typeof __VLS_components.ATable, typeof __VLS_components.aTable, ]} */ ;
    // @ts-ignore
    const __VLS_26 = __VLS_asFunctionalComponent(__VLS_25, new __VLS_25({
        columns: (__VLS_ctx.columns),
        dataSource: (__VLS_ctx.modules),
        loading: (__VLS_ctx.loading),
        rowKey: "id",
        pagination: (false),
        size: "middle",
    }));
    const __VLS_27 = __VLS_26({
        columns: (__VLS_ctx.columns),
        dataSource: (__VLS_ctx.modules),
        loading: (__VLS_ctx.loading),
        rowKey: "id",
        pagination: (false),
        size: "middle",
    }, ...__VLS_functionalComponentArgsRest(__VLS_26));
    __VLS_28.slots.default;
    {
        const { bodyCell: __VLS_thisSlot } = __VLS_28.slots;
        const [{ column, record }] = __VLS_getSlotParams(__VLS_thisSlot);
        if (column.key === 'toolCount') {
            const __VLS_29 = {}.ATag;
            /** @type {[typeof __VLS_components.ATag, typeof __VLS_components.aTag, typeof __VLS_components.ATag, typeof __VLS_components.aTag, ]} */ ;
            // @ts-ignore
            const __VLS_30 = __VLS_asFunctionalComponent(__VLS_29, new __VLS_29({
                color: "blue",
            }));
            const __VLS_31 = __VLS_30({
                color: "blue",
            }, ...__VLS_functionalComponentArgsRest(__VLS_30));
            __VLS_32.slots.default;
            (record.tools?.length ?? 0);
            var __VLS_32;
        }
        else if (column.key === 'enabled') {
            const __VLS_33 = {}.ASwitch;
            /** @type {[typeof __VLS_components.ASwitch, typeof __VLS_components.aSwitch, ]} */ ;
            // @ts-ignore
            const __VLS_34 = __VLS_asFunctionalComponent(__VLS_33, new __VLS_33({
                ...{ 'onChange': {} },
                checked: (record.enabled === 1),
            }));
            const __VLS_35 = __VLS_34({
                ...{ 'onChange': {} },
                checked: (record.enabled === 1),
            }, ...__VLS_functionalComponentArgsRest(__VLS_34));
            let __VLS_37;
            let __VLS_38;
            let __VLS_39;
            const __VLS_40 = {
                onChange: ((checked) => __VLS_ctx.onToggle(record, checked))
            };
            var __VLS_36;
        }
        else if (column.key === 'action') {
            const __VLS_41 = {}.ASpace;
            /** @type {[typeof __VLS_components.ASpace, typeof __VLS_components.aSpace, typeof __VLS_components.ASpace, typeof __VLS_components.aSpace, ]} */ ;
            // @ts-ignore
            const __VLS_42 = __VLS_asFunctionalComponent(__VLS_41, new __VLS_41({}));
            const __VLS_43 = __VLS_42({}, ...__VLS_functionalComponentArgsRest(__VLS_42));
            __VLS_44.slots.default;
            const __VLS_45 = {}.AButton;
            /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
            // @ts-ignore
            const __VLS_46 = __VLS_asFunctionalComponent(__VLS_45, new __VLS_45({
                ...{ 'onClick': {} },
                size: "small",
            }));
            const __VLS_47 = __VLS_46({
                ...{ 'onClick': {} },
                size: "small",
            }, ...__VLS_functionalComponentArgsRest(__VLS_46));
            let __VLS_49;
            let __VLS_50;
            let __VLS_51;
            const __VLS_52 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeTab === 'modules'))
                        return;
                    if (!!(column.key === 'toolCount'))
                        return;
                    if (!!(column.key === 'enabled'))
                        return;
                    if (!(column.key === 'action'))
                        return;
                    __VLS_ctx.openDebug(record);
                }
            };
            __VLS_48.slots.default;
            var __VLS_48;
            const __VLS_53 = {}.AButton;
            /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
            // @ts-ignore
            const __VLS_54 = __VLS_asFunctionalComponent(__VLS_53, new __VLS_53({
                ...{ 'onClick': {} },
                size: "small",
            }));
            const __VLS_55 = __VLS_54({
                ...{ 'onClick': {} },
                size: "small",
            }, ...__VLS_functionalComponentArgsRest(__VLS_54));
            let __VLS_57;
            let __VLS_58;
            let __VLS_59;
            const __VLS_60 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeTab === 'modules'))
                        return;
                    if (!!(column.key === 'toolCount'))
                        return;
                    if (!!(column.key === 'enabled'))
                        return;
                    if (!(column.key === 'action'))
                        return;
                    __VLS_ctx.openEdit(record);
                }
            };
            __VLS_56.slots.default;
            var __VLS_56;
            const __VLS_61 = {}.APopconfirm;
            /** @type {[typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, ]} */ ;
            // @ts-ignore
            const __VLS_62 = __VLS_asFunctionalComponent(__VLS_61, new __VLS_61({
                ...{ 'onConfirm': {} },
                title: "确定删除该模块？",
            }));
            const __VLS_63 = __VLS_62({
                ...{ 'onConfirm': {} },
                title: "确定删除该模块？",
            }, ...__VLS_functionalComponentArgsRest(__VLS_62));
            let __VLS_65;
            let __VLS_66;
            let __VLS_67;
            const __VLS_68 = {
                onConfirm: (...[$event]) => {
                    if (!(__VLS_ctx.activeTab === 'modules'))
                        return;
                    if (!!(column.key === 'toolCount'))
                        return;
                    if (!!(column.key === 'enabled'))
                        return;
                    if (!(column.key === 'action'))
                        return;
                    __VLS_ctx.onDelete(record);
                }
            };
            __VLS_64.slots.default;
            const __VLS_69 = {}.AButton;
            /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
            // @ts-ignore
            const __VLS_70 = __VLS_asFunctionalComponent(__VLS_69, new __VLS_69({
                size: "small",
                danger: true,
            }));
            const __VLS_71 = __VLS_70({
                size: "small",
                danger: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_70));
            __VLS_72.slots.default;
            var __VLS_72;
            var __VLS_64;
            var __VLS_44;
        }
    }
    var __VLS_28;
    const __VLS_73 = {}.AModal;
    /** @type {[typeof __VLS_components.AModal, typeof __VLS_components.aModal, typeof __VLS_components.AModal, typeof __VLS_components.aModal, ]} */ ;
    // @ts-ignore
    const __VLS_74 = __VLS_asFunctionalComponent(__VLS_73, new __VLS_73({
        ...{ 'onOk': {} },
        open: (__VLS_ctx.editVisible),
        title: (__VLS_ctx.editingId ? '编辑模块' : '添加模块'),
        width: "760px",
    }));
    const __VLS_75 = __VLS_74({
        ...{ 'onOk': {} },
        open: (__VLS_ctx.editVisible),
        title: (__VLS_ctx.editingId ? '编辑模块' : '添加模块'),
        width: "760px",
    }, ...__VLS_functionalComponentArgsRest(__VLS_74));
    let __VLS_77;
    let __VLS_78;
    let __VLS_79;
    const __VLS_80 = {
        onOk: (__VLS_ctx.submitEdit)
    };
    __VLS_76.slots.default;
    const __VLS_81 = {}.AForm;
    /** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
    // @ts-ignore
    const __VLS_82 = __VLS_asFunctionalComponent(__VLS_81, new __VLS_81({
        layout: "vertical",
    }));
    const __VLS_83 = __VLS_82({
        layout: "vertical",
    }, ...__VLS_functionalComponentArgsRest(__VLS_82));
    __VLS_84.slots.default;
    const __VLS_85 = {}.ARow;
    /** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
    // @ts-ignore
    const __VLS_86 = __VLS_asFunctionalComponent(__VLS_85, new __VLS_85({
        gutter: (16),
    }));
    const __VLS_87 = __VLS_86({
        gutter: (16),
    }, ...__VLS_functionalComponentArgsRest(__VLS_86));
    __VLS_88.slots.default;
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
        label: "模块名",
        required: true,
    }));
    const __VLS_95 = __VLS_94({
        label: "模块名",
        required: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_94));
    __VLS_96.slots.default;
    const __VLS_97 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_98 = __VLS_asFunctionalComponent(__VLS_97, new __VLS_97({
        value: (__VLS_ctx.editForm.name),
        placeholder: "如：用户服务",
    }));
    const __VLS_99 = __VLS_98({
        value: (__VLS_ctx.editForm.name),
        placeholder: "如：用户服务",
    }, ...__VLS_functionalComponentArgsRest(__VLS_98));
    var __VLS_96;
    var __VLS_92;
    const __VLS_101 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_102 = __VLS_asFunctionalComponent(__VLS_101, new __VLS_101({
        span: (12),
    }));
    const __VLS_103 = __VLS_102({
        span: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_102));
    __VLS_104.slots.default;
    const __VLS_105 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_106 = __VLS_asFunctionalComponent(__VLS_105, new __VLS_105({
        label: "描述",
    }));
    const __VLS_107 = __VLS_106({
        label: "描述",
    }, ...__VLS_functionalComponentArgsRest(__VLS_106));
    __VLS_108.slots.default;
    const __VLS_109 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_110 = __VLS_asFunctionalComponent(__VLS_109, new __VLS_109({
        value: (__VLS_ctx.editForm.description),
    }));
    const __VLS_111 = __VLS_110({
        value: (__VLS_ctx.editForm.description),
    }, ...__VLS_functionalComponentArgsRest(__VLS_110));
    var __VLS_108;
    var __VLS_104;
    var __VLS_88;
    const __VLS_113 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_114 = __VLS_asFunctionalComponent(__VLS_113, new __VLS_113({
        label: "服务地址 base_url",
        required: true,
    }));
    const __VLS_115 = __VLS_114({
        label: "服务地址 base_url",
        required: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_114));
    __VLS_116.slots.default;
    const __VLS_117 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_118 = __VLS_asFunctionalComponent(__VLS_117, new __VLS_117({
        value: (__VLS_ctx.editForm.base_url),
        placeholder: "http://172.16.16.10:8080",
    }));
    const __VLS_119 = __VLS_118({
        value: (__VLS_ctx.editForm.base_url),
        placeholder: "http://172.16.16.10:8080",
    }, ...__VLS_functionalComponentArgsRest(__VLS_118));
    var __VLS_116;
    const __VLS_121 = {}.ARow;
    /** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
    // @ts-ignore
    const __VLS_122 = __VLS_asFunctionalComponent(__VLS_121, new __VLS_121({
        gutter: (16),
    }));
    const __VLS_123 = __VLS_122({
        gutter: (16),
    }, ...__VLS_functionalComponentArgsRest(__VLS_122));
    __VLS_124.slots.default;
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
        label: "超时（秒）",
    }));
    const __VLS_131 = __VLS_130({
        label: "超时（秒）",
    }, ...__VLS_functionalComponentArgsRest(__VLS_130));
    __VLS_132.slots.default;
    const __VLS_133 = {}.AInputNumber;
    /** @type {[typeof __VLS_components.AInputNumber, typeof __VLS_components.aInputNumber, ]} */ ;
    // @ts-ignore
    const __VLS_134 = __VLS_asFunctionalComponent(__VLS_133, new __VLS_133({
        value: (__VLS_ctx.editForm.timeout),
        min: (1),
        ...{ style: {} },
    }));
    const __VLS_135 = __VLS_134({
        value: (__VLS_ctx.editForm.timeout),
        min: (1),
        ...{ style: {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_134));
    var __VLS_132;
    var __VLS_128;
    const __VLS_137 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_138 = __VLS_asFunctionalComponent(__VLS_137, new __VLS_137({
        span: (12),
    }));
    const __VLS_139 = __VLS_138({
        span: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_138));
    __VLS_140.slots.default;
    const __VLS_141 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_142 = __VLS_asFunctionalComponent(__VLS_141, new __VLS_141({
        label: "鉴权类型",
    }));
    const __VLS_143 = __VLS_142({
        label: "鉴权类型",
    }, ...__VLS_functionalComponentArgsRest(__VLS_142));
    __VLS_144.slots.default;
    const __VLS_145 = {}.ASelect;
    /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
    // @ts-ignore
    const __VLS_146 = __VLS_asFunctionalComponent(__VLS_145, new __VLS_145({
        value: (__VLS_ctx.editForm.auth_type),
        placeholder: "无鉴权",
    }));
    const __VLS_147 = __VLS_146({
        value: (__VLS_ctx.editForm.auth_type),
        placeholder: "无鉴权",
    }, ...__VLS_functionalComponentArgsRest(__VLS_146));
    __VLS_148.slots.default;
    const __VLS_149 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_150 = __VLS_asFunctionalComponent(__VLS_149, new __VLS_149({
        value: "",
    }));
    const __VLS_151 = __VLS_150({
        value: "",
    }, ...__VLS_functionalComponentArgsRest(__VLS_150));
    __VLS_152.slots.default;
    var __VLS_152;
    const __VLS_153 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_154 = __VLS_asFunctionalComponent(__VLS_153, new __VLS_153({
        value: "bearer",
    }));
    const __VLS_155 = __VLS_154({
        value: "bearer",
    }, ...__VLS_functionalComponentArgsRest(__VLS_154));
    __VLS_156.slots.default;
    var __VLS_156;
    const __VLS_157 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_158 = __VLS_asFunctionalComponent(__VLS_157, new __VLS_157({
        value: "basic",
    }));
    const __VLS_159 = __VLS_158({
        value: "basic",
    }, ...__VLS_functionalComponentArgsRest(__VLS_158));
    __VLS_160.slots.default;
    var __VLS_160;
    const __VLS_161 = {}.ASelectOption;
    /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
    // @ts-ignore
    const __VLS_162 = __VLS_asFunctionalComponent(__VLS_161, new __VLS_161({
        value: "header",
    }));
    const __VLS_163 = __VLS_162({
        value: "header",
    }, ...__VLS_functionalComponentArgsRest(__VLS_162));
    __VLS_164.slots.default;
    var __VLS_164;
    var __VLS_148;
    var __VLS_144;
    var __VLS_140;
    var __VLS_124;
    const __VLS_165 = {}.ADivider;
    /** @type {[typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, ]} */ ;
    // @ts-ignore
    const __VLS_166 = __VLS_asFunctionalComponent(__VLS_165, new __VLS_165({}));
    const __VLS_167 = __VLS_166({}, ...__VLS_functionalComponentArgsRest(__VLS_166));
    __VLS_168.slots.default;
    var __VLS_168;
    for (const [tool, ti] of __VLS_getVForSourceType((__VLS_ctx.editForm.tools))) {
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            key: (ti),
            ...{ class: "tool-card" },
        });
        const __VLS_169 = {}.ARow;
        /** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
        // @ts-ignore
        const __VLS_170 = __VLS_asFunctionalComponent(__VLS_169, new __VLS_169({
            gutter: (8),
        }));
        const __VLS_171 = __VLS_170({
            gutter: (8),
        }, ...__VLS_functionalComponentArgsRest(__VLS_170));
        __VLS_172.slots.default;
        const __VLS_173 = {}.ACol;
        /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
        // @ts-ignore
        const __VLS_174 = __VLS_asFunctionalComponent(__VLS_173, new __VLS_173({
            span: (6),
        }));
        const __VLS_175 = __VLS_174({
            span: (6),
        }, ...__VLS_functionalComponentArgsRest(__VLS_174));
        __VLS_176.slots.default;
        const __VLS_177 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_178 = __VLS_asFunctionalComponent(__VLS_177, new __VLS_177({
            value: (tool.name),
            placeholder: "工具名",
        }));
        const __VLS_179 = __VLS_178({
            value: (tool.name),
            placeholder: "工具名",
        }, ...__VLS_functionalComponentArgsRest(__VLS_178));
        var __VLS_176;
        const __VLS_181 = {}.ACol;
        /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
        // @ts-ignore
        const __VLS_182 = __VLS_asFunctionalComponent(__VLS_181, new __VLS_181({
            span: (5),
        }));
        const __VLS_183 = __VLS_182({
            span: (5),
        }, ...__VLS_functionalComponentArgsRest(__VLS_182));
        __VLS_184.slots.default;
        const __VLS_185 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_186 = __VLS_asFunctionalComponent(__VLS_185, new __VLS_185({
            value: (tool.description),
            placeholder: "描述",
        }));
        const __VLS_187 = __VLS_186({
            value: (tool.description),
            placeholder: "描述",
        }, ...__VLS_functionalComponentArgsRest(__VLS_186));
        var __VLS_184;
        const __VLS_189 = {}.ACol;
        /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
        // @ts-ignore
        const __VLS_190 = __VLS_asFunctionalComponent(__VLS_189, new __VLS_189({
            span: (4),
        }));
        const __VLS_191 = __VLS_190({
            span: (4),
        }, ...__VLS_functionalComponentArgsRest(__VLS_190));
        __VLS_192.slots.default;
        const __VLS_193 = {}.ASelect;
        /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
        // @ts-ignore
        const __VLS_194 = __VLS_asFunctionalComponent(__VLS_193, new __VLS_193({
            value: (tool.method),
        }));
        const __VLS_195 = __VLS_194({
            value: (tool.method),
        }, ...__VLS_functionalComponentArgsRest(__VLS_194));
        __VLS_196.slots.default;
        const __VLS_197 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_198 = __VLS_asFunctionalComponent(__VLS_197, new __VLS_197({
            value: "GET",
        }));
        const __VLS_199 = __VLS_198({
            value: "GET",
        }, ...__VLS_functionalComponentArgsRest(__VLS_198));
        __VLS_200.slots.default;
        var __VLS_200;
        const __VLS_201 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_202 = __VLS_asFunctionalComponent(__VLS_201, new __VLS_201({
            value: "POST",
        }));
        const __VLS_203 = __VLS_202({
            value: "POST",
        }, ...__VLS_functionalComponentArgsRest(__VLS_202));
        __VLS_204.slots.default;
        var __VLS_204;
        const __VLS_205 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_206 = __VLS_asFunctionalComponent(__VLS_205, new __VLS_205({
            value: "PUT",
        }));
        const __VLS_207 = __VLS_206({
            value: "PUT",
        }, ...__VLS_functionalComponentArgsRest(__VLS_206));
        __VLS_208.slots.default;
        var __VLS_208;
        const __VLS_209 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_210 = __VLS_asFunctionalComponent(__VLS_209, new __VLS_209({
            value: "PATCH",
        }));
        const __VLS_211 = __VLS_210({
            value: "PATCH",
        }, ...__VLS_functionalComponentArgsRest(__VLS_210));
        __VLS_212.slots.default;
        var __VLS_212;
        const __VLS_213 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_214 = __VLS_asFunctionalComponent(__VLS_213, new __VLS_213({
            value: "DELETE",
        }));
        const __VLS_215 = __VLS_214({
            value: "DELETE",
        }, ...__VLS_functionalComponentArgsRest(__VLS_214));
        __VLS_216.slots.default;
        var __VLS_216;
        var __VLS_196;
        var __VLS_192;
        const __VLS_217 = {}.ACol;
        /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
        // @ts-ignore
        const __VLS_218 = __VLS_asFunctionalComponent(__VLS_217, new __VLS_217({
            span: (6),
        }));
        const __VLS_219 = __VLS_218({
            span: (6),
        }, ...__VLS_functionalComponentArgsRest(__VLS_218));
        __VLS_220.slots.default;
        const __VLS_221 = {}.AInput;
        /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
        // @ts-ignore
        const __VLS_222 = __VLS_asFunctionalComponent(__VLS_221, new __VLS_221({
            value: (tool.path),
            placeholder: "/api/xxx/{id}",
        }));
        const __VLS_223 = __VLS_222({
            value: (tool.path),
            placeholder: "/api/xxx/{id}",
        }, ...__VLS_functionalComponentArgsRest(__VLS_222));
        var __VLS_220;
        const __VLS_225 = {}.ACol;
        /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
        // @ts-ignore
        const __VLS_226 = __VLS_asFunctionalComponent(__VLS_225, new __VLS_225({
            span: (3),
        }));
        const __VLS_227 = __VLS_226({
            span: (3),
        }, ...__VLS_functionalComponentArgsRest(__VLS_226));
        __VLS_228.slots.default;
        const __VLS_229 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_230 = __VLS_asFunctionalComponent(__VLS_229, new __VLS_229({
            ...{ 'onClick': {} },
            size: "small",
            danger: true,
        }));
        const __VLS_231 = __VLS_230({
            ...{ 'onClick': {} },
            size: "small",
            danger: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_230));
        let __VLS_233;
        let __VLS_234;
        let __VLS_235;
        const __VLS_236 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.activeTab === 'modules'))
                    return;
                __VLS_ctx.removeTool(ti);
            }
        };
        __VLS_232.slots.default;
        var __VLS_232;
        var __VLS_228;
        var __VLS_172;
        __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
            ...{ class: "param-list" },
        });
        for (const [p, pi] of __VLS_getVForSourceType((tool.params))) {
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                key: (pi),
                ...{ class: "param-row" },
            });
            const __VLS_237 = {}.AInput;
            /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
            // @ts-ignore
            const __VLS_238 = __VLS_asFunctionalComponent(__VLS_237, new __VLS_237({
                value: (p.name),
                placeholder: "参数名",
                size: "small",
                ...{ style: {} },
            }));
            const __VLS_239 = __VLS_238({
                value: (p.name),
                placeholder: "参数名",
                size: "small",
                ...{ style: {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_238));
            const __VLS_241 = {}.ASelect;
            /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
            // @ts-ignore
            const __VLS_242 = __VLS_asFunctionalComponent(__VLS_241, new __VLS_241({
                value: (p.type),
                size: "small",
                ...{ style: {} },
            }));
            const __VLS_243 = __VLS_242({
                value: (p.type),
                size: "small",
                ...{ style: {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_242));
            __VLS_244.slots.default;
            const __VLS_245 = {}.ASelectOption;
            /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
            // @ts-ignore
            const __VLS_246 = __VLS_asFunctionalComponent(__VLS_245, new __VLS_245({
                value: "string",
            }));
            const __VLS_247 = __VLS_246({
                value: "string",
            }, ...__VLS_functionalComponentArgsRest(__VLS_246));
            __VLS_248.slots.default;
            var __VLS_248;
            const __VLS_249 = {}.ASelectOption;
            /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
            // @ts-ignore
            const __VLS_250 = __VLS_asFunctionalComponent(__VLS_249, new __VLS_249({
                value: "integer",
            }));
            const __VLS_251 = __VLS_250({
                value: "integer",
            }, ...__VLS_functionalComponentArgsRest(__VLS_250));
            __VLS_252.slots.default;
            var __VLS_252;
            const __VLS_253 = {}.ASelectOption;
            /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
            // @ts-ignore
            const __VLS_254 = __VLS_asFunctionalComponent(__VLS_253, new __VLS_253({
                value: "number",
            }));
            const __VLS_255 = __VLS_254({
                value: "number",
            }, ...__VLS_functionalComponentArgsRest(__VLS_254));
            __VLS_256.slots.default;
            var __VLS_256;
            const __VLS_257 = {}.ASelectOption;
            /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
            // @ts-ignore
            const __VLS_258 = __VLS_asFunctionalComponent(__VLS_257, new __VLS_257({
                value: "boolean",
            }));
            const __VLS_259 = __VLS_258({
                value: "boolean",
            }, ...__VLS_functionalComponentArgsRest(__VLS_258));
            __VLS_260.slots.default;
            var __VLS_260;
            var __VLS_244;
            const __VLS_261 = {}.ACheckbox;
            /** @type {[typeof __VLS_components.ACheckbox, typeof __VLS_components.aCheckbox, typeof __VLS_components.ACheckbox, typeof __VLS_components.aCheckbox, ]} */ ;
            // @ts-ignore
            const __VLS_262 = __VLS_asFunctionalComponent(__VLS_261, new __VLS_261({
                checked: (p.required),
            }));
            const __VLS_263 = __VLS_262({
                checked: (p.required),
            }, ...__VLS_functionalComponentArgsRest(__VLS_262));
            __VLS_264.slots.default;
            var __VLS_264;
            const __VLS_265 = {}.AInput;
            /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
            // @ts-ignore
            const __VLS_266 = __VLS_asFunctionalComponent(__VLS_265, new __VLS_265({
                value: (p.description),
                placeholder: "参数描述",
                size: "small",
                ...{ style: {} },
            }));
            const __VLS_267 = __VLS_266({
                value: (p.description),
                placeholder: "参数描述",
                size: "small",
                ...{ style: {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_266));
            const __VLS_269 = {}.AButton;
            /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
            // @ts-ignore
            const __VLS_270 = __VLS_asFunctionalComponent(__VLS_269, new __VLS_269({
                ...{ 'onClick': {} },
                size: "small",
                type: "link",
                danger: true,
            }));
            const __VLS_271 = __VLS_270({
                ...{ 'onClick': {} },
                size: "small",
                type: "link",
                danger: true,
            }, ...__VLS_functionalComponentArgsRest(__VLS_270));
            let __VLS_273;
            let __VLS_274;
            let __VLS_275;
            const __VLS_276 = {
                onClick: (...[$event]) => {
                    if (!(__VLS_ctx.activeTab === 'modules'))
                        return;
                    __VLS_ctx.removeParam(tool, pi);
                }
            };
            __VLS_272.slots.default;
            var __VLS_272;
        }
        const __VLS_277 = {}.AButton;
        /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
        // @ts-ignore
        const __VLS_278 = __VLS_asFunctionalComponent(__VLS_277, new __VLS_277({
            ...{ 'onClick': {} },
            size: "small",
            type: "dashed",
            block: true,
        }));
        const __VLS_279 = __VLS_278({
            ...{ 'onClick': {} },
            size: "small",
            type: "dashed",
            block: true,
        }, ...__VLS_functionalComponentArgsRest(__VLS_278));
        let __VLS_281;
        let __VLS_282;
        let __VLS_283;
        const __VLS_284 = {
            onClick: (...[$event]) => {
                if (!(__VLS_ctx.activeTab === 'modules'))
                    return;
                __VLS_ctx.addParam(tool);
            }
        };
        __VLS_280.slots.default;
        var __VLS_280;
    }
    const __VLS_285 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_286 = __VLS_asFunctionalComponent(__VLS_285, new __VLS_285({
        ...{ 'onClick': {} },
        type: "dashed",
        block: true,
    }));
    const __VLS_287 = __VLS_286({
        ...{ 'onClick': {} },
        type: "dashed",
        block: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_286));
    let __VLS_289;
    let __VLS_290;
    let __VLS_291;
    const __VLS_292 = {
        onClick: (__VLS_ctx.addTool)
    };
    __VLS_288.slots.default;
    var __VLS_288;
    var __VLS_84;
    var __VLS_76;
    const __VLS_293 = {}.AModal;
    /** @type {[typeof __VLS_components.AModal, typeof __VLS_components.aModal, typeof __VLS_components.AModal, typeof __VLS_components.aModal, ]} */ ;
    // @ts-ignore
    const __VLS_294 = __VLS_asFunctionalComponent(__VLS_293, new __VLS_293({
        open: (__VLS_ctx.debugVisible),
        title: (`调试 ${__VLS_ctx.debugModule?.name ?? ''}`),
        width: "640px",
        footer: (null),
    }));
    const __VLS_295 = __VLS_294({
        open: (__VLS_ctx.debugVisible),
        title: (`调试 ${__VLS_ctx.debugModule?.name ?? ''}`),
        width: "640px",
        footer: (null),
    }, ...__VLS_functionalComponentArgsRest(__VLS_294));
    __VLS_296.slots.default;
    const __VLS_297 = {}.AForm;
    /** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
    // @ts-ignore
    const __VLS_298 = __VLS_asFunctionalComponent(__VLS_297, new __VLS_297({
        layout: "vertical",
    }));
    const __VLS_299 = __VLS_298({
        layout: "vertical",
    }, ...__VLS_functionalComponentArgsRest(__VLS_298));
    __VLS_300.slots.default;
    const __VLS_301 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_302 = __VLS_asFunctionalComponent(__VLS_301, new __VLS_301({
        label: "选择工具",
    }));
    const __VLS_303 = __VLS_302({
        label: "选择工具",
    }, ...__VLS_functionalComponentArgsRest(__VLS_302));
    __VLS_304.slots.default;
    const __VLS_305 = {}.ASelect;
    /** @type {[typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, typeof __VLS_components.ASelect, typeof __VLS_components.aSelect, ]} */ ;
    // @ts-ignore
    const __VLS_306 = __VLS_asFunctionalComponent(__VLS_305, new __VLS_305({
        value: (__VLS_ctx.debugTool),
    }));
    const __VLS_307 = __VLS_306({
        value: (__VLS_ctx.debugTool),
    }, ...__VLS_functionalComponentArgsRest(__VLS_306));
    __VLS_308.slots.default;
    for (const [t] of __VLS_getVForSourceType((__VLS_ctx.debugModule?.tools ?? []))) {
        const __VLS_309 = {}.ASelectOption;
        /** @type {[typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, typeof __VLS_components.ASelectOption, typeof __VLS_components.aSelectOption, ]} */ ;
        // @ts-ignore
        const __VLS_310 = __VLS_asFunctionalComponent(__VLS_309, new __VLS_309({
            key: (t.name),
            value: (t.name),
        }));
        const __VLS_311 = __VLS_310({
            key: (t.name),
            value: (t.name),
        }, ...__VLS_functionalComponentArgsRest(__VLS_310));
        __VLS_312.slots.default;
        (t.name);
        (t.method);
        (t.path);
        var __VLS_312;
    }
    var __VLS_308;
    var __VLS_304;
    for (const [p] of __VLS_getVForSourceType((__VLS_ctx.currentTool()?.params ?? []))) {
        const __VLS_313 = {}.AFormItem;
        /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
        // @ts-ignore
        const __VLS_314 = __VLS_asFunctionalComponent(__VLS_313, new __VLS_313({
            label: (`${p.name}${p.required ? ' *' : ''}`),
        }));
        const __VLS_315 = __VLS_314({
            label: (`${p.name}${p.required ? ' *' : ''}`),
        }, ...__VLS_functionalComponentArgsRest(__VLS_314));
        __VLS_316.slots.default;
        if (p.type === 'integer' || p.type === 'number') {
            const __VLS_317 = {}.AInputNumber;
            /** @type {[typeof __VLS_components.AInputNumber, typeof __VLS_components.aInputNumber, ]} */ ;
            // @ts-ignore
            const __VLS_318 = __VLS_asFunctionalComponent(__VLS_317, new __VLS_317({
                value: (__VLS_ctx.debugArgs[p.name]),
                ...{ style: {} },
            }));
            const __VLS_319 = __VLS_318({
                value: (__VLS_ctx.debugArgs[p.name]),
                ...{ style: {} },
            }, ...__VLS_functionalComponentArgsRest(__VLS_318));
        }
        else if (p.type === 'boolean') {
            const __VLS_321 = {}.ASwitch;
            /** @type {[typeof __VLS_components.ASwitch, typeof __VLS_components.aSwitch, ]} */ ;
            // @ts-ignore
            const __VLS_322 = __VLS_asFunctionalComponent(__VLS_321, new __VLS_321({
                checked: (__VLS_ctx.debugArgs[p.name]),
            }));
            const __VLS_323 = __VLS_322({
                checked: (__VLS_ctx.debugArgs[p.name]),
            }, ...__VLS_functionalComponentArgsRest(__VLS_322));
        }
        else {
            const __VLS_325 = {}.AInput;
            /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
            // @ts-ignore
            const __VLS_326 = __VLS_asFunctionalComponent(__VLS_325, new __VLS_325({
                value: (__VLS_ctx.debugArgs[p.name]),
                placeholder: (p.description),
            }));
            const __VLS_327 = __VLS_326({
                value: (__VLS_ctx.debugArgs[p.name]),
                placeholder: (p.description),
            }, ...__VLS_functionalComponentArgsRest(__VLS_326));
        }
        var __VLS_316;
    }
    const __VLS_329 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_330 = __VLS_asFunctionalComponent(__VLS_329, new __VLS_329({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.debugLoading),
    }));
    const __VLS_331 = __VLS_330({
        ...{ 'onClick': {} },
        type: "primary",
        loading: (__VLS_ctx.debugLoading),
    }, ...__VLS_functionalComponentArgsRest(__VLS_330));
    let __VLS_333;
    let __VLS_334;
    let __VLS_335;
    const __VLS_336 = {
        onClick: (__VLS_ctx.runDebug)
    };
    __VLS_332.slots.default;
    var __VLS_332;
    var __VLS_300;
    const __VLS_337 = {}.ADivider;
    /** @type {[typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, ]} */ ;
    // @ts-ignore
    const __VLS_338 = __VLS_asFunctionalComponent(__VLS_337, new __VLS_337({}));
    const __VLS_339 = __VLS_338({}, ...__VLS_functionalComponentArgsRest(__VLS_338));
    __VLS_340.slots.default;
    var __VLS_340;
    __VLS_asFunctionalElement(__VLS_intrinsicElements.pre, __VLS_intrinsicElements.pre)({
        ...{ class: "result" },
    });
    (__VLS_ctx.debugResult || '（暂无结果）');
    var __VLS_296;
}
else if (__VLS_ctx.activeTab === 'keys') {
    const __VLS_341 = {}.ARow;
    /** @type {[typeof __VLS_components.ARow, typeof __VLS_components.aRow, typeof __VLS_components.ARow, typeof __VLS_components.aRow, ]} */ ;
    // @ts-ignore
    const __VLS_342 = __VLS_asFunctionalComponent(__VLS_341, new __VLS_341({
        gutter: (24),
    }));
    const __VLS_343 = __VLS_342({
        gutter: (24),
    }, ...__VLS_functionalComponentArgsRest(__VLS_342));
    __VLS_344.slots.default;
    const __VLS_345 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_346 = __VLS_asFunctionalComponent(__VLS_345, new __VLS_345({
        span: (12),
    }));
    const __VLS_347 = __VLS_346({
        span: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_346));
    __VLS_348.slots.default;
    const __VLS_349 = {}.ACard;
    /** @type {[typeof __VLS_components.ACard, typeof __VLS_components.aCard, typeof __VLS_components.ACard, typeof __VLS_components.aCard, ]} */ ;
    // @ts-ignore
    const __VLS_350 = __VLS_asFunctionalComponent(__VLS_349, new __VLS_349({
        title: "申请 API Key",
        size: "small",
    }));
    const __VLS_351 = __VLS_350({
        title: "申请 API Key",
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_350));
    __VLS_352.slots.default;
    const __VLS_353 = {}.AForm;
    /** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
    // @ts-ignore
    const __VLS_354 = __VLS_asFunctionalComponent(__VLS_353, new __VLS_353({
        layout: "vertical",
    }));
    const __VLS_355 = __VLS_354({
        layout: "vertical",
    }, ...__VLS_functionalComponentArgsRest(__VLS_354));
    __VLS_356.slots.default;
    const __VLS_357 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_358 = __VLS_asFunctionalComponent(__VLS_357, new __VLS_357({
        label: "邮箱（接收验证码）",
        required: true,
    }));
    const __VLS_359 = __VLS_358({
        label: "邮箱（接收验证码）",
        required: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_358));
    __VLS_360.slots.default;
    const __VLS_361 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_362 = __VLS_asFunctionalComponent(__VLS_361, new __VLS_361({
        value: (__VLS_ctx.applyEmail),
        placeholder: "you@example.com",
    }));
    const __VLS_363 = __VLS_362({
        value: (__VLS_ctx.applyEmail),
        placeholder: "you@example.com",
    }, ...__VLS_functionalComponentArgsRest(__VLS_362));
    var __VLS_360;
    const __VLS_365 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_366 = __VLS_asFunctionalComponent(__VLS_365, new __VLS_365({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.applyLoading),
        block: true,
    }));
    const __VLS_367 = __VLS_366({
        ...{ 'onClick': {} },
        loading: (__VLS_ctx.applyLoading),
        block: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_366));
    let __VLS_369;
    let __VLS_370;
    let __VLS_371;
    const __VLS_372 = {
        onClick: (__VLS_ctx.onApply)
    };
    __VLS_368.slots.default;
    var __VLS_368;
    if (__VLS_ctx.applyMsg) {
        const __VLS_373 = {}.AAlert;
        /** @type {[typeof __VLS_components.AAlert, typeof __VLS_components.aAlert, ]} */ ;
        // @ts-ignore
        const __VLS_374 = __VLS_asFunctionalComponent(__VLS_373, new __VLS_373({
            type: "success",
            message: (__VLS_ctx.applyMsg),
            showIcon: true,
            ...{ style: {} },
        }));
        const __VLS_375 = __VLS_374({
            type: "success",
            message: (__VLS_ctx.applyMsg),
            showIcon: true,
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_374));
    }
    const __VLS_377 = {}.ADivider;
    /** @type {[typeof __VLS_components.ADivider, typeof __VLS_components.aDivider, ]} */ ;
    // @ts-ignore
    const __VLS_378 = __VLS_asFunctionalComponent(__VLS_377, new __VLS_377({}));
    const __VLS_379 = __VLS_378({}, ...__VLS_functionalComponentArgsRest(__VLS_378));
    const __VLS_381 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_382 = __VLS_asFunctionalComponent(__VLS_381, new __VLS_381({
        label: "验证码",
    }));
    const __VLS_383 = __VLS_382({
        label: "验证码",
    }, ...__VLS_functionalComponentArgsRest(__VLS_382));
    __VLS_384.slots.default;
    const __VLS_385 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_386 = __VLS_asFunctionalComponent(__VLS_385, new __VLS_385({
        value: (__VLS_ctx.code),
        placeholder: "6 位验证码",
    }));
    const __VLS_387 = __VLS_386({
        value: (__VLS_ctx.code),
        placeholder: "6 位验证码",
    }, ...__VLS_functionalComponentArgsRest(__VLS_386));
    var __VLS_384;
    const __VLS_389 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_390 = __VLS_asFunctionalComponent(__VLS_389, new __VLS_389({
        label: "名称（可选）",
    }));
    const __VLS_391 = __VLS_390({
        label: "名称（可选）",
    }, ...__VLS_functionalComponentArgsRest(__VLS_390));
    __VLS_392.slots.default;
    const __VLS_393 = {}.AInput;
    /** @type {[typeof __VLS_components.AInput, typeof __VLS_components.aInput, ]} */ ;
    // @ts-ignore
    const __VLS_394 = __VLS_asFunctionalComponent(__VLS_393, new __VLS_393({
        value: (__VLS_ctx.keyName),
        placeholder: "如：我的 AI 助手",
    }));
    const __VLS_395 = __VLS_394({
        value: (__VLS_ctx.keyName),
        placeholder: "如：我的 AI 助手",
    }, ...__VLS_functionalComponentArgsRest(__VLS_394));
    var __VLS_392;
    const __VLS_397 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_398 = __VLS_asFunctionalComponent(__VLS_397, new __VLS_397({
        ...{ 'onClick': {} },
        type: "primary",
        block: true,
        disabled: (!__VLS_ctx.code),
    }));
    const __VLS_399 = __VLS_398({
        ...{ 'onClick': {} },
        type: "primary",
        block: true,
        disabled: (!__VLS_ctx.code),
    }, ...__VLS_functionalComponentArgsRest(__VLS_398));
    let __VLS_401;
    let __VLS_402;
    let __VLS_403;
    const __VLS_404 = {
        onClick: (__VLS_ctx.onVerify)
    };
    __VLS_400.slots.default;
    var __VLS_400;
    if (__VLS_ctx.keyResult) {
        const __VLS_405 = {}.AAlert;
        /** @type {[typeof __VLS_components.AAlert, typeof __VLS_components.aAlert, typeof __VLS_components.AAlert, typeof __VLS_components.aAlert, ]} */ ;
        // @ts-ignore
        const __VLS_406 = __VLS_asFunctionalComponent(__VLS_405, new __VLS_405({
            type: "info",
            showIcon: true,
            ...{ style: {} },
        }));
        const __VLS_407 = __VLS_406({
            type: "info",
            showIcon: true,
            ...{ style: {} },
        }, ...__VLS_functionalComponentArgsRest(__VLS_406));
        __VLS_408.slots.default;
        {
            const { message: __VLS_thisSlot } = __VLS_408.slots;
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({});
            __VLS_asFunctionalElement(__VLS_intrinsicElements.div, __VLS_intrinsicElements.div)({
                ...{ class: "key-box" },
            });
            (__VLS_ctx.keyResult);
            const __VLS_409 = {}.AButton;
            /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
            // @ts-ignore
            const __VLS_410 = __VLS_asFunctionalComponent(__VLS_409, new __VLS_409({
                ...{ 'onClick': {} },
                size: "small",
                type: "link",
            }));
            const __VLS_411 = __VLS_410({
                ...{ 'onClick': {} },
                size: "small",
                type: "link",
            }, ...__VLS_functionalComponentArgsRest(__VLS_410));
            let __VLS_413;
            let __VLS_414;
            let __VLS_415;
            const __VLS_416 = {
                onClick: (__VLS_ctx.copyKey)
            };
            __VLS_412.slots.default;
            var __VLS_412;
        }
        var __VLS_408;
    }
    var __VLS_356;
    var __VLS_352;
    var __VLS_348;
    const __VLS_417 = {}.ACol;
    /** @type {[typeof __VLS_components.ACol, typeof __VLS_components.aCol, typeof __VLS_components.ACol, typeof __VLS_components.aCol, ]} */ ;
    // @ts-ignore
    const __VLS_418 = __VLS_asFunctionalComponent(__VLS_417, new __VLS_417({
        span: (12),
    }));
    const __VLS_419 = __VLS_418({
        span: (12),
    }, ...__VLS_functionalComponentArgsRest(__VLS_418));
    __VLS_420.slots.default;
    const __VLS_421 = {}.ACard;
    /** @type {[typeof __VLS_components.ACard, typeof __VLS_components.aCard, typeof __VLS_components.ACard, typeof __VLS_components.aCard, ]} */ ;
    // @ts-ignore
    const __VLS_422 = __VLS_asFunctionalComponent(__VLS_421, new __VLS_421({
        title: "Key 管理（运营）",
        size: "small",
    }));
    const __VLS_423 = __VLS_422({
        title: "Key 管理（运营）",
        size: "small",
    }, ...__VLS_functionalComponentArgsRest(__VLS_422));
    __VLS_424.slots.default;
    const __VLS_425 = {}.AForm;
    /** @type {[typeof __VLS_components.AForm, typeof __VLS_components.aForm, typeof __VLS_components.AForm, typeof __VLS_components.aForm, ]} */ ;
    // @ts-ignore
    const __VLS_426 = __VLS_asFunctionalComponent(__VLS_425, new __VLS_425({
        layout: "vertical",
    }));
    const __VLS_427 = __VLS_426({
        layout: "vertical",
    }, ...__VLS_functionalComponentArgsRest(__VLS_426));
    __VLS_428.slots.default;
    const __VLS_429 = {}.AFormItem;
    /** @type {[typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, typeof __VLS_components.AFormItem, typeof __VLS_components.aFormItem, ]} */ ;
    // @ts-ignore
    const __VLS_430 = __VLS_asFunctionalComponent(__VLS_429, new __VLS_429({
        label: "管理员密钥 (X-Admin-Key)",
    }));
    const __VLS_431 = __VLS_430({
        label: "管理员密钥 (X-Admin-Key)",
    }, ...__VLS_functionalComponentArgsRest(__VLS_430));
    __VLS_432.slots.default;
    const __VLS_433 = {}.AInputPassword;
    /** @type {[typeof __VLS_components.AInputPassword, typeof __VLS_components.aInputPassword, ]} */ ;
    // @ts-ignore
    const __VLS_434 = __VLS_asFunctionalComponent(__VLS_433, new __VLS_433({
        value: (__VLS_ctx.adminKey),
        placeholder: "MCP_ADMIN_KEY",
    }));
    const __VLS_435 = __VLS_434({
        value: (__VLS_ctx.adminKey),
        placeholder: "MCP_ADMIN_KEY",
    }, ...__VLS_functionalComponentArgsRest(__VLS_434));
    var __VLS_432;
    const __VLS_437 = {}.AButton;
    /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
    // @ts-ignore
    const __VLS_438 = __VLS_asFunctionalComponent(__VLS_437, new __VLS_437({
        ...{ 'onClick': {} },
        block: true,
    }));
    const __VLS_439 = __VLS_438({
        ...{ 'onClick': {} },
        block: true,
    }, ...__VLS_functionalComponentArgsRest(__VLS_438));
    let __VLS_441;
    let __VLS_442;
    let __VLS_443;
    const __VLS_444 = {
        onClick: (__VLS_ctx.loadKeys)
    };
    __VLS_440.slots.default;
    var __VLS_440;
    var __VLS_428;
    const __VLS_445 = {}.ATable;
    /** @type {[typeof __VLS_components.ATable, typeof __VLS_components.aTable, typeof __VLS_components.ATable, typeof __VLS_components.aTable, ]} */ ;
    // @ts-ignore
    const __VLS_446 = __VLS_asFunctionalComponent(__VLS_445, new __VLS_445({
        columns: (__VLS_ctx.keyColumns),
        dataSource: (__VLS_ctx.keys),
        loading: (__VLS_ctx.adminLoading),
        rowKey: "id",
        size: "small",
        ...{ style: {} },
    }));
    const __VLS_447 = __VLS_446({
        columns: (__VLS_ctx.keyColumns),
        dataSource: (__VLS_ctx.keys),
        loading: (__VLS_ctx.adminLoading),
        rowKey: "id",
        size: "small",
        ...{ style: {} },
    }, ...__VLS_functionalComponentArgsRest(__VLS_446));
    __VLS_448.slots.default;
    {
        const { bodyCell: __VLS_thisSlot } = __VLS_448.slots;
        const [{ column, record }] = __VLS_getSlotParams(__VLS_thisSlot);
        if (column.key === 'action') {
            const __VLS_449 = {}.APopconfirm;
            /** @type {[typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, typeof __VLS_components.APopconfirm, typeof __VLS_components.aPopconfirm, ]} */ ;
            // @ts-ignore
            const __VLS_450 = __VLS_asFunctionalComponent(__VLS_449, new __VLS_449({
                ...{ 'onConfirm': {} },
                title: "确定吊销该 Key？",
            }));
            const __VLS_451 = __VLS_450({
                ...{ 'onConfirm': {} },
                title: "确定吊销该 Key？",
            }, ...__VLS_functionalComponentArgsRest(__VLS_450));
            let __VLS_453;
            let __VLS_454;
            let __VLS_455;
            const __VLS_456 = {
                onConfirm: (...[$event]) => {
                    if (!!(__VLS_ctx.activeTab === 'modules'))
                        return;
                    if (!(__VLS_ctx.activeTab === 'keys'))
                        return;
                    if (!(column.key === 'action'))
                        return;
                    __VLS_ctx.onRevoke(record.id);
                }
            };
            __VLS_452.slots.default;
            const __VLS_457 = {}.AButton;
            /** @type {[typeof __VLS_components.AButton, typeof __VLS_components.aButton, typeof __VLS_components.AButton, typeof __VLS_components.aButton, ]} */ ;
            // @ts-ignore
            const __VLS_458 = __VLS_asFunctionalComponent(__VLS_457, new __VLS_457({
                size: "small",
                danger: true,
                disabled: (record.status === 'revoked'),
            }));
            const __VLS_459 = __VLS_458({
                size: "small",
                danger: true,
                disabled: (record.status === 'revoked'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_458));
            __VLS_460.slots.default;
            var __VLS_460;
            var __VLS_452;
        }
        else if (column.dataIndex === 'status') {
            const __VLS_461 = {}.ATag;
            /** @type {[typeof __VLS_components.ATag, typeof __VLS_components.aTag, typeof __VLS_components.ATag, typeof __VLS_components.aTag, ]} */ ;
            // @ts-ignore
            const __VLS_462 = __VLS_asFunctionalComponent(__VLS_461, new __VLS_461({
                color: (record.status === 'active' ? 'green' : 'default'),
            }));
            const __VLS_463 = __VLS_462({
                color: (record.status === 'active' ? 'green' : 'default'),
            }, ...__VLS_functionalComponentArgsRest(__VLS_462));
            __VLS_464.slots.default;
            (record.status === 'active' ? '有效' : '已吊销');
            var __VLS_464;
        }
    }
    var __VLS_448;
    var __VLS_424;
    var __VLS_420;
    var __VLS_344;
}
var __VLS_3;
/** @type {__VLS_StyleScopedClasses['page']} */ ;
/** @type {__VLS_StyleScopedClasses['header']} */ ;
/** @type {__VLS_StyleScopedClasses['tool-card']} */ ;
/** @type {__VLS_StyleScopedClasses['param-list']} */ ;
/** @type {__VLS_StyleScopedClasses['param-row']} */ ;
/** @type {__VLS_StyleScopedClasses['result']} */ ;
/** @type {__VLS_StyleScopedClasses['key-box']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup() {
        return {
            antdTheme: antdTheme,
            activeTab: activeTab,
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
            applyEmail: applyEmail,
            applyLoading: applyLoading,
            code: code,
            keyName: keyName,
            keyResult: keyResult,
            applyMsg: applyMsg,
            onApply: onApply,
            onVerify: onVerify,
            copyKey: copyKey,
            adminKey: adminKey,
            keys: keys,
            adminLoading: adminLoading,
            loadKeys: loadKeys,
            onRevoke: onRevoke,
            keyColumns: keyColumns,
        };
    },
});
export default (await import('vue')).defineComponent({
    setup() {
        return {};
    },
});
; /* PartiallyEnd: #4569/main.vue */
