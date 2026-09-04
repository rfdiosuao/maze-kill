<template>
  <div class="login-bg">
    <div class="login-box">
      <div class="brand">迷宫全息剧本杀</div>
      <div class="sub">超级管理员后台</div>
      <el-form @submit.prevent>
        <el-form-item>
          <el-input v-model="form.staff_no" placeholder="管理员编号（999）" size="large" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" placeholder="密码" size="large" show-password @keyup.enter="login" />
        </el-form-item>
        <el-button type="danger" size="large" style="width:100%" :loading="loading" @click="login">登 录</el-button>
      </el-form>
      <div class="tip">演示账号：999 / admin888</div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import api from '../api';

const router = useRouter();
const form = reactive({ staff_no: '999', password: '' });
const loading = ref(false);

const login = () => {
  if (!form.staff_no || !form.password) return ElMessage.warning('请输入账号密码');
  loading.value = true;
  api.post('/admin/login', form).then(d => {
    localStorage.setItem('token', d.data.token);
    localStorage.setItem('admin_name', d.data.name);
    router.push('/dashboard');
  }).finally(() => loading.value = false);
};
</script>

<style scoped>
.login-bg { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(160deg, #7A0E13 0%, #3A0709 45%, #0D0B0C 100%); }
.login-box { width: 380px; padding: 40px 36px; background: rgba(13,11,12,.92); border: 1px solid rgba(212,175,55,.35); border-radius: 16px; }
.brand { color: #F5EFE6; font-size: 26px; font-weight: 700; text-align: center; letter-spacing: 4px; }
.sub { color: #D4AF37; font-size: 13px; text-align: center; margin: 8px 0 28px; letter-spacing: 3px; }
.tip { color: #8C8680; font-size: 12px; text-align: center; margin-top: 16px; }
</style>
