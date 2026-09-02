<template>
  <a-tabs v-model:activeKey="activeTab">
    <!-- 本地工具 -->
    <a-tab-pane key="tool" tab="本地工具">
      <a-alert
        type="info"
        show-icon
        message="本地工具为代码内注册的工具名（如 contract-irr、image-gen）。输入名称回车添加。"
        :style="{ marginBottom: '12px' }"
      />
      <a-select
        v-model:value="localTools"
        mode="tags"
        placeholder="输入本地工具名回车添加"
        :style="{ width: '100%' }"
        @change="emitCaps"
      />
    </a-tab-pane>

    <!-- MCP 工具 -->
    <a-tab-pane key="mcp" tab="MCP 工具" :disabled="!mcpModules.length">
      <a-empty v-if="!mcpModules.length" description="MCP 网关无可用模块（请先在 MCP 管理配置模块）" />
      <div v-for="mod in mcpModules" :key="mod.id" class="mcp-module">
        <div class="mcp-module-head">
          <span class="mcp-module-name">{{ mod.name }}</span>
          <a-tag size="small" color="default">{{ mod.code_key }}</a-tag>
        </div>
        <div class="mcp-tool-grid">
          <label
            v-for="tool in mod.tools"
            :key="`${mod.code_key}/${tool.name}`"
            class="mcp-tool-item"
            :class="{ checked: mcpSelected.includes(`${mod.code_key}/${tool.name}`) }"
          >
            <a-checkbox
              :checked="mcpSelected.includes(`${mod.code_key}/${tool.name}`)"
              @change="(e: any) => toggleMcp(`${mod.code_key}/${tool.name}`, e.target.checked)"
            >
              <span class="mcp-tool-name">{{ tool.name }}</span>
              <span class="mcp-tool-desc">{{ tool.description || tool.method + ' ' + tool.path }}</span>
            </a-checkbox>
          </label>
        </div>
      </div>
    </a-tab-pane>

    <!-- Skills -->
    <a-tab-pane key="skill" tab="Skills" :disabled="!skills.length">
      <a-empty v-if="!skills.length" description="技能库为空，请先到「技能库」导入/创建技能" />
      <div class="skill-list">
        <label
          v-for="s in skills"
          :key="s.code"
          class="skill-item"
          :class="{ checked: skillSelected.includes(s.code) }"
        >
          <a-checkbox
            :checked="skillSelected.includes(s.code)"
            @change="(e: any) => toggleSkill(s, e.target.checked)"
          >
            <div class="skill-main">
              <div class="skill-head">
                <span class="skill-name">{{ s.name }}</span>
                <a-tag size="small" color="default">{{ s.code }}</a-tag>
                <a-tag size="small" color="purple">on-demand</a-tag>
              </div>
              <div class="skill-desc">{{ s.description }}</div>
              <div v-if="s.requiredTools?.length" class="skill-deps">
                依赖工具：<a-tag v-for="t in s.requiredTools" :key="t" size="small">{{ t }}</a-tag>
              </div>
            </div>
          </a-checkbox>
        </label>
      </div>
    </a-tab-pane>
  </a-tabs>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { listMcpModules, type CapabilityRef, type McpModuleItem } from '@/api/agent-defs';
import { listSkills, type SkillItem } from '@/api/skills';

const props = defineProps<{ capabilities: CapabilityRef[] }>();
const emit = defineEmits<{
  (e: 'update:capabilities', v: CapabilityRef[]): void;
}>();

const activeTab = ref('tool');
const localTools = ref<string[]>([]);
const mcpSelected = ref<string[]>([]);
const skillSelected = ref<string[]>([]);
const mcpModules = ref<McpModuleItem[]>([]);
const skills = ref<SkillItem[]>([]);

/** 从 props.capabilities 拆分为三个状态 */
function sync() {
  const caps = props.capabilities || [];
  localTools.value = caps.filter((c) => c.type === 'tool' && c.enabled !== false).map((c) => c.ref);
  mcpSelected.value = caps.filter((c) => c.type === 'mcp' && c.enabled !== false).map((c) => c.ref);
  skillSelected.value = caps.filter((c) => c.type === 'skill' && c.enabled !== false).map((c) => c.ref);
}

function emitCaps() {
  const caps: CapabilityRef[] = [
    ...localTools.value.map((t) => ({ type: 'tool' as const, ref: t, enabled: true })),
    ...mcpSelected.value.map((m) => ({ type: 'mcp' as const, ref: m, enabled: true })),
    ...skillSelected.value.map((s) => ({ type: 'skill' as const, ref: s, enabled: true })),
  ];
  emit('update:capabilities', caps);
}

function toggleMcp(ref: string, checked: boolean) {
  if (checked) {
    if (!mcpSelected.value.includes(ref)) mcpSelected.value.push(ref);
  } else {
    mcpSelected.value = mcpSelected.value.filter((m) => m !== ref);
  }
  emitCaps();
}

/** 勾选技能时自动带入依赖工具（只加不减） */
function toggleSkill(skill: SkillItem, checked: boolean) {
  if (checked) {
    if (!skillSelected.value.includes(skill.code)) skillSelected.value.push(skill.code);
    for (const t of skill.requiredTools || []) {
      if (t.includes(':')) {
        if (!mcpSelected.value.includes(t)) mcpSelected.value.push(t);
      } else if (!localTools.value.includes(t)) {
        localTools.value.push(t);
      }
    }
  } else {
    skillSelected.value = skillSelected.value.filter((s) => s !== skill.code);
  }
  emitCaps();
}

async function load() {
  try {
    const res: any = await listMcpModules();
    const modules = (res?.modules || res || []) as McpModuleItem[];
    mcpModules.value = modules.filter((m) => m.enabled && m.tools?.length);
  } catch {
    mcpModules.value = [];
  }
  try {
    const res: any = await listSkills();
    skills.value = ((res?.data ?? res) || []) as SkillItem[];
  } catch {
    skills.value = [];
  }
}

watch(() => props.capabilities, sync, { deep: true });
onMounted(() => {
  sync();
  void load();
});
</script>

<style scoped>
.mcp-module {
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.mcp-module-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed #eee;
  margin-bottom: 10px;
}
.mcp-module-name {
  font-weight: 600;
  color: #333;
}
.mcp-tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 6px;
}
.mcp-tool-item {
  padding: 6px 8px;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all .2s;
}
.mcp-tool-item.checked {
  background: rgba(22, 119, 255, .04);
  border-color: #91caff;
}
.mcp-tool-name {
  font-family: monospace;
  font-size: 12px;
}
.mcp-tool-desc {
  margin-left: 8px;
  font-size: 12px;
  color: #999;
}
.skill-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 8px;
}
.skill-item {
  padding: 10px 12px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all .2s;
}
.skill-item.checked {
  background: rgba(114, 46, 209, .04);
  border-color: #b37feb;
}
.skill-main {
  padding-left: 8px;
}
.skill-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.skill-name {
  font-weight: 600;
  color: #333;
}
.skill-desc {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
.skill-deps {
  font-size: 12px;
  color: #666;
  margin-top: 6px;
}
</style>
