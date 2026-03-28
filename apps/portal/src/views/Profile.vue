<template>
  <div class="profile-page">
    <div class="profile-container">
      <div class="profile-header">
        <h1>个人中心</h1>
      </div>

      <div class="profile-content">
        <a-card title="头像设置" class="profile-card">
          <div class="avatar-section">
            <div class="avatar-preview">
              <a-avatar :size="120" :src="userAvatar" />
            </div>
            <div class="avatar-actions">
              <a-upload
                name="avatar"
                :show-upload-list="false"
                :before-upload="beforeAvatarUpload"
                :custom-request="handleAvatarUpload"
                accept="image/*"
              >
                <a-button type="primary" icon="upload">
                  {{ uploading ? '上传中...' : '上传头像' }}
                </a-button>
              </a-upload>
              <p class="avatar-tip">支持 JPG、PNG 格式，大小不超过 2MB</p>
            </div>
          </div>
        </a-card>

        <a-card title="基本信息" class="profile-card">
          <a-form :model="formData" :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
            <a-form-item label="用户名">
              <a-input v-model:value="formData.username" disabled />
            </a-form-item>
            <a-form-item label="邮箱">
              <a-input v-model:value="formData.email" placeholder="请输入邮箱" />
            </a-form-item>
            <a-form-item label="昵称">
              <a-input v-model:value="formData.nickname" placeholder="请输入昵称" />
            </a-form-item>
            <a-form-item label="手机号">
              <a-input v-model:value="formData.phone" placeholder="请输入手机号" />
            </a-form-item>
            <a-form-item :wrapper-col="{ offset: 6, span: 16 }">
              <a-button type="primary" @click="handleSave" :loading="saving">
                保存修改
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import { updateUserProfile, uploadAvatar } from '@/api/user';

const userStore = useUserStore();
const uploading = ref(false);
const saving = ref(false);

const DEFAULT_AVATAR = '/avatars/default-avatar.png';

const userAvatar = computed(() => {
  return userStore.userInfo?.avatar || DEFAULT_AVATAR;
});

const formData = reactive({
  username: '',
  email: '',
  nickname: '',
  phone: '',
});

onMounted(() => {
  loadUserInfo();
});

function loadUserInfo() {
  const userInfo = userStore.userInfo;
  if (userInfo) {
    formData.username = userInfo.username || '';
    formData.email = userInfo.email || '';
    formData.nickname = userInfo.nickname || '';
    formData.phone = userInfo.phone || '';
  }
}

function beforeAvatarUpload(file: File) {
  const isImage = file.type.startsWith('image/');
  const isLt2M = file.size / 1024 / 1024 < 2;

  if (!isImage) {
    message.error('只能上传图片文件！');
    return false;
  }
  if (!isLt2M) {
    message.error('图片大小不能超过 2MB！');
    return false;
  }
  return true;
}

async function handleAvatarUpload({ file, onSuccess, onError }: any) {
  uploading.value = true;
  try {
    const formDataUpload = new FormData();
    formDataUpload.append('avatar', file);

    const result = await uploadAvatar(formDataUpload);
    
    // 更新本地用户信息
    userStore.setUserInfo({
      ...userStore.userInfo,
      avatar: result.avatarUrl,
    });

    message.success('头像上传成功');
    onSuccess(result);
  } catch (error) {
    console.error('Upload error:', error);
    message.error('头像上传失败');
    onError(error);
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
    });

    // 更新本地用户信息
    userStore.setUserInfo({
      ...userStore.userInfo,
      email: formData.email,
      nickname: formData.nickname,
      phone: formData.phone,
    });

    message.success('保存成功');
  } catch (error) {
    console.error('Save error:', error);
    message.error('保存失败');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.profile-page {
  min-height: 100vh;
  background: #f0f2f5;
  padding: 24px;
}

.profile-container {
  max-width: 800px;
  margin: 0 auto;
}

.profile-header {
  margin-bottom: 24px;
}

.profile-header h1 {
  margin: 0;
  font-size: 24px;
  color: #333;
}

.profile-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.profile-card {
  border-radius: 8px;
}

.avatar-section {
  display: flex;
  align-items: center;
  gap: 40px;
}

.avatar-preview {
  flex-shrink: 0;
}

.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.avatar-tip {
  margin: 0;
  color: #999;
  font-size: 12px;
}
</style>
