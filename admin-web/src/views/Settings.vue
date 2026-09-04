<template>
  <div>
    <h2 class="page-title">系统设置（午晚场时间 / 每场DM数 / 奖金阶梯 / 联系方式）</h2>
    <el-card shadow="never" style="max-width:720px">
      <el-form label-width="120px" v-if="s.id !== undefined">
        <el-form-item label="午场开场时间"><el-time-select v-model="s.noon_start" start="09:00" step="00:30" end="16:00" /></el-form-item>
        <el-form-item label="晚场开场时间"><el-time-select v-model="s.night_start" start="17:00" step="00:30" end="23:00" /></el-form-item>
        <el-form-item label="每场DM数">
          <el-radio-group v-model="s.dm_per_session"><el-radio :value="3">3名</el-radio><el-radio :value="4">4名</el-radio></el-radio-group>
        </el-form-item>
        <el-form-item label="阶梯奖金">
          <div style="width:100%">
            <div v-for="(b, i) in s.bonus_ladder" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
              <el-input-number v-model="b.min" :min="1" placeholder="当月场次≥" />
              <el-input-number v-model="b.pay" :min="0" :step="100" placeholder="奖金" />
              <el-button type="danger" plain size="small" @click="s.bonus_ladder.splice(i,1)">删</el-button>
            </div>
            <el-button size="small" @click="s.bonus_ladder.push({ min: 10, pay: 500 })">+ 添加档位</el-button>
          </div>
        </el-form-item>
        <el-divider>到店与联系方式（小程序首页展示）</el-divider>
        <el-form-item label="电话"><el-input v-model="s.phone" /></el-form-item>
        <el-form-item label="客服微信号"><el-input v-model="s.wechat" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="s.address" /></el-form-item>
        <el-row>
          <el-col :span="12"><el-form-item label="纬度lat"><el-input-number v-model="s.lat" :precision="6" :step="0.001" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="经度lng"><el-input-number v-model="s.lng" :precision="6" :step="0.001" /></el-form-item></el-col>
        </el-row>
        <el-form-item>
          <el-button type="danger" @click="save">保存设置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" style="max-width:720px;margin-top:14px">
      <template #header>管理操作日志（近100条）</template>
      <el-table :data="logs" size="small" max-height="320">
        <el-table-column prop="admin_name" label="管理员" width="110" />
        <el-table-column prop="action" label="操作" width="150" />
        <el-table-column prop="target" label="对象" min-width="180" />
        <el-table-column prop="created_at" label="时间" width="170" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const s = reactive({ id: undefined, bonus_ladder: [] });
const logs = ref([]);

onMounted(() => {
  api.get('/admin/settings').then(r => Object.assign(s, r.data, { bonus_ladder: r.data.bonus_ladder || [] }));
  api.get('/admin/logs').then(r => logs.value = r.data);
});

const save = () => api.put('/admin/settings', s).then(() => ElMessage.success('已保存'));
</script>
