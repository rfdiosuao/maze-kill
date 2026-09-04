<template>
  <div>
    <h2 class="page-title">总览（仅管理员可见）</h2>
    <el-row :gutter="16">
      <el-col :span="6" v-for="s in stats" :key="s.label">
        <el-card shadow="never"><div class="stat-num">{{ s.value }}</div><div class="stat-label">{{ s.label }}</div></el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" style="margin-top:16px">
      <template #header>
        <div style="display:flex;align-items:center">
          <span>缺人预警场次</span>
          <el-button type="danger" size="small" style="margin-left:auto" :loading="filling" @click="doFill">执行自动补位（72h内）</el-button>
        </div>
      </template>
      <el-table :data="d.warnList" size="small">
        <el-table-column prop="work_date" label="日期" width="120" />
        <el-table-column label="时段" width="90">
          <template #default="{ row }">{{ row.slot === 'noon' ? '午场' : '晚场' }}</template>
        </el-table-column>
        <el-table-column prop="script_name" label="剧本" />
        <el-table-column label="DM" width="120">
          <template #default="{ row }">
            <span :class="row.assigned < row.required_dm ? 'warn' : 'gold'">{{ row.assigned }}/{{ row.required_dm }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110">
          <template #default="{ row }">
            <el-button size="small" @click="$router.push('/sessions')">去排班</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const d = ref({ warnList: [], fill: { req: 0, got: 0 }, salarySum: 0, salaryMonth: '', sessions7: 0, bookings: 0, warns: 0 });
const filling = ref(false);

const stats = computed(() => [
  { label: '未来7天场次', value: d.value.sessions7 },
  { label: '有效预约', value: d.value.bookings },
  { label: `排班完成度（${d.value.fill.got}/${d.value.fill.req}）`,
    value: d.value.fill.req ? Math.round(d.value.fill.got / d.value.fill.req * 100) + '%' : '-' },
  { label: '缺人预警场次', value: d.value.warns },
  { label: `本月薪资应发汇总（${d.value.salaryMonth}）`, value: '¥' + d.value.salarySum }
]);

const load = () => api.get('/admin/dashboard').then(r => d.value = r.data);

const doFill = () => {
  filling.value = true;
  api.post('/admin/autofill').then(r => {
    ElMessage.success(`补位完成：新补 ${r.data.filled} 席，仍缺人 ${r.data.warnings.length} 场`);
    load();
  }).finally(() => filling.value = false);
};

onMounted(load);
</script>
