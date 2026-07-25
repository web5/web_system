<template>
  <div class="profile-page">
    <!-- 顶部导航已迁移到全局 App.vue -->

    <div class="profile-container">
      <div class="profile-card avatar-card">
        <div class="card-title">头像设置</div>
        <div class="avatar-section">
          <div class="avatar-preview">
            <img :src="avatarSrc" class="avatar-img" />
          </div>
          <div class="avatar-actions">
            <label class="upload-btn" :class="{ uploading: uploading }">
              <input type="file" accept="image/*" @change="handleFileChange" />
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {{ uploading ? '上传中...' : '上传头像' }}
            </label>
            <p class="avatar-tip">支持 JPG、PNG 格式，大小不超过 2MB</p>
          </div>
        </div>
      </div>

      <div class="profile-card info-card">
        <div class="card-title">快捷入口</div>
        <div class="quick-actions">
          <div class="quick-action-item" @click="$router.push('/album')">
            <div class="qa-icon album">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </div>
            <div class="qa-info">
              <p class="qa-name">我的相册</p>
              <p class="qa-desc">查看已保存的作品</p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>
      </div>

      <div class="profile-card info-card">
        <div class="card-title">基本信息</div>
        <div class="form-section">
          <div class="form-row">
            <label>用户名</label>
            <input v-model="formData.username" disabled class="form-input disabled" />
          </div>
          <div class="form-row">
            <label>邮箱</label>
            <input v-model="formData.email" placeholder="请输入邮箱" class="form-input" />
          </div>
          <div class="form-row">
            <label>昵称</label>
            <input v-model="formData.nickname" placeholder="请输入昵称" class="form-input" />
          </div>
          <div class="form-row">
            <label>手机号</label>
            <input v-model="formData.phone" placeholder="请输入手机号" class="form-input" />
          </div>
          <div class="form-row">
            <label>性别</label>
            <a-radio-group v-model:value="formData.gender" button-style="solid">
              <a-radio-button value="male">男</a-radio-button>
              <a-radio-button value="female">女</a-radio-button>
              <a-radio-button value="unknown">保密</a-radio-button>
            </a-radio-group>
          </div>
          <div class="form-actions">
            <button class="btn-save" @click="handleSave" :disabled="saving">
              {{ saving ? '保存中...' : '保存修改' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import { updateUserProfile, uploadAvatar } from '@/api/user';

const userStore = useUserStore();
const uploading = ref(false);
const saving = ref(false);

const avatarSrc = computed(() => {
  const info = userStore.userInfo;
  if (info?.avatar) return info.avatar;
  return info?.gender === 'female' ? '/avatars/default-female.png' : '/avatars/default-male.png';
});

const formData = reactive({
  username: '',
  email: '',
  nickname: '',
  phone: '',
  gender: 'unknown' as 'male' | 'female' | 'unknown',
});

onMounted(() => {
  loadUserInfo();
});

function loadUserInfo() {
  const info = userStore.userInfo;
  if (info) {
    formData.username = info.username || '';
    formData.email = info.email || '';
    formData.nickname = info.nickname || '';
    formData.phone = info.phone || '';
    formData.gender = (info.gender as 'male' | 'female' | 'unknown') || 'unknown';
  }
}

function handleFileChange(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const isImage = file.type.startsWith('image/');
  const isLt2M = file.size / 1024 / 1024 < 2;
  if (!isImage) {
    message.error('只能上传图片文件！');
    return;
  }
  if (!isLt2M) {
    message.error('图片大小不能超过 2MB！');
    return;
  }

  handleAvatarUpload(file);
}

async function handleAvatarUpload(file: File) {
  uploading.value = true;
  try {
    const fd = new FormData();
    fd.append('avatar', file);
    const result = await uploadAvatar(fd);
    // 兼容两种返回格式：{ avatarUrl } 或 { code, data: { avatarUrl } }
    const avatarUrl = (result as any).avatarUrl || (result as any).data?.avatarUrl;
    if (!avatarUrl) {
      throw new Error('上传响应缺少头像 URL');
    }
    userStore.setUserInfo({
      ...userStore.userInfo,
      avatar: avatarUrl,
    });
    message.success('头像上传成功');
  } catch {
    message.error('头像上传失败');
  } finally {
    uploading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  try {
    await updateUserProfile({
      email: formData.email,
      nickname: formData.nickname,
      phone: formData.phone,
      gender: formData.gender,
    });
    userStore.setUserInfo({
      ...userStore.userInfo,
      email: formData.email,
      nickname: formData.nickname,
      phone: formData.phone,
      gender: formData.gender,
    });
    message.success('保存成功');
  } catch {
    message.error('保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: #FFF8F0;
}

.profile-container {
  max-width: 640px;
  margin: 0 auto;
  padding: 24px 16px;
}

.profile-card {
  background: white;
  border-radius: 4px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #333;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f0f0f0;
}

/* ===== 头像区域 ===== */
.avatar-section {
  display: flex;
  align-items: center;
  gap: 24px;
}

.avatar-preview {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: #FFF8F0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #eee;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #FF8C42;
  color: white;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  border: none;
  width: fit-content;
}

.upload-btn:hover {
  background: #e67e3a;
}

.upload-btn.uploading {
  background: #ccc;
  cursor: not-allowed;
}

.upload-btn input[type="file"] {
  display: none;
}

.avatar-tip {
  margin: 0;
  font-size: 12px;
  color: #999;
}

/* ===== 快捷入口 ===== */
.quick-actions {
  display: flex;
  flex-direction: column;
}

.quick-action-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  cursor: pointer;
  border-bottom: 1px solid #f5f5f5;
  transition: background 0.15s;
}

.quick-action-item:last-child {
  border-bottom: none;
}

.quick-action-item:hover {
  background: #fff8f2;
  margin: 0 -20px;
  padding: 14px 20px;
  border-radius: 8px;
}

.qa-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qa-icon.album {
  background: linear-gradient(135deg, #FFE0CC, #FFD4B8);
  color: #FF8C42;
}

.qa-info {
  flex: 1;
  min-width: 0;
}

.qa-name {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #333;
}

.qa-desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: #aaa;
}

/* ===== 表单区域 ===== */
.form-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-row label {
  font-size: 13px;
  color: #666;
  font-weight: 500;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  border: 2px solid #eee;
  border-radius: 4px;
  font-size: 14px;
  color: #333;
  background: white;
  transition: border-color 0.2s;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: #FF8C42;
}

.form-input.disabled {
  background: #f5f5f5;
  color: #999;
  cursor: not-allowed;
}

.form-input::placeholder {
  color: #ccc;
}

.form-actions {
  margin-top: 8px;
}

.btn-save {
  padding: 10px 24px;
  background: #FF8C42;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-save:hover {
  background: #e67e3a;
}

.btn-save:disabled {
  background: #ccc;
  cursor: not-allowed;
}
</style>
