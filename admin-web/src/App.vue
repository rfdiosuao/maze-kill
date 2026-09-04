<template>
  <el-container v-if="$route.path !== '/login'" class="layout">
    <el-aside width="210px" class="aside">
      <div class="logo">迷宫全息剧本杀</div>
      <div class="logo-sub">超级管理员后台</div>
      <el-menu :default-active="$route.path" router background-color="transparent" text-color="#CFC8C0" active-text-color="#D4AF37">
        <el-menu-item v-for="r in menuRoutes" :key="r.path" :index="r.path">{{ r.meta.title }}</el-menu-item>
      </el-menu>
      <div class="logout">
        <el-button size="small" @click="logout">退出登录</el-button>
      </div>
    </el-aside>
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
  <router-view v-else />
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import router from './router';

const route = useRoute();
const menuRoutes = computed(() => router.options.routes.filter(r => r.meta && r.meta.menu));

const logout = () => {
  localStorage.removeItem('token');
  router.push('/login');
};
</script>

<style scoped>
.layout { min-height: 100vh; }
.aside { background: linear-gradient(180deg, #1A1113, #0D0B0C); border-right: 1px solid rgba(212,175,55,.18); display: flex; flex-direction: column; position: relative; }
.logo { color: #D4AF37; font-size: 18px; font-weight: 700; padding: 22px 20px 4px; letter-spacing: 2px; }
.logo-sub { color: #8C8680; font-size: 12px; padding: 0 20px 14px; border-bottom: 1px solid rgba(212,175,55,.15); }
.el-menu { border-right: none; flex: 1; }
.logout { padding: 16px 20px; }
.main { padding: 24px; }
</style>
