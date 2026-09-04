<template>
  <div>
    <h2 class="page-title">薪资管理（按自然月 · 应发=底薪+Σ角色提成+阶梯奖金-扣除 · 排班变动自动重算）</h2>
    <el-card shadow="never">
      <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center">
        <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" @change="load" />
        <el-button type="danger" @click="load">重算刷新</el-button>
        <div style="flex:1"></div>
        <el-button @click="exportCsv">导出CSV</el-button>
      </div>
      <el-table :data="list" size="small" :summary-method="sum" show-summary>
        <el-table-column prop="staff_no" label="编号" width="70" />
        <el-table-column prop="stage_name" label="花名" width="110" />
        <el-table-column prop="sessions" label="出场场次" width="90" />
        <el-table-column label="底薪" width="100"><template #default="{ row }">¥{{ row.base_salary }}</template></el-table-column>
        <el-table-column label="提成Σ" width="100"><template #default="{ row }">¥{{ row.commission }}</template></el-table-column>
        <el-table-column label="奖金" width="90"><template #default="{ row }">¥{{ row.bonus }}</template></el-table-column>
        <el-table-column label="扣除" width="100">
          <template #default="{ row }">
            <el-link type="warning" @click="editDeduction(row)">¥{{ row.deduction }}</el-link>
          </template>
        </el-table-column>
        <el-table-column label="应发" width="120"><template #default="{ row }"><span class="gold">¥{{ row.payable }}</span></template></el-table-column>
        <el-table-column label="明细" width="90">
          <template #default="{ row }"><el-button size="small" @click="showDetail(row)">查看</el-button></template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="detailDlg" :title="`${detail.stage_name} · ${month} 出场明细（可追溯）`" width="640px">
      <el-table :data="detail.detail" size="small" max-height="420">
        <el-table-column prop="date" label="日期" width="110" />
        <el-table-column prop="slot" label="时段" width="70" />
        <el-table-column prop="script" label="剧本" min-width="150" />
        <el-table-column prop="role" label="角色" width="110" />
        <el-table-column prop="commission" label="单场提成" width="90"><template #default="{ row }">¥{{ row.commission }}</template></el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import api from '../api';

const month = ref(dayjs().format('YYYY-MM'));
const list = ref([]); const detailDlg = ref(false);
const detail = ref({ stage_name: '', detail: [] });

const load = () => api.get('/admin/salary', { params: { month: month.value } }).then(r => list.value = r.data.list);

const showDetail = row => { detail.value = row; detailDlg.value = true; };

const editDeduction = row => ElMessageBox.prompt(`调整 ${row.stage_name} ${month.value} 的扣除金额`, '扣除项', { inputValue: String(row.deduction) })
  .then(({ value }) => api.put(`/admin/salary/${row.dm_id}`, { month: month.value, deduction: value })
    .then(() => { ElMessage.success('已更新并重算'); load(); }));

// CSV导出（底薪/明细仅管理员可见）
const exportCsv = () => {
  const head = '编号,花名,出场场次,底薪,提成,奖金,扣除,应发\n';
  const body = list.value.map(r => [r.staff_no, r.stage_name, r.sessions, r.base_salary, r.commission, r.bonus, r.deduction, r.payable].join(',')).join('\n');
  const blob = new Blob(['\ufeff' + head + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `薪资_${month.value}.csv`;
  a.click();
};

const sum = ({ columns, data }) => columns.map((c, i) => {
  if (i === 0) return '合计';
  if (c.label === '提成Σ') return '¥' + data.reduce((s, r) => s + r.commission, 0);
  if (c.label === '奖金') return '¥' + data.reduce((s, r) => s + r.bonus, 0);
  if (c.label === '扣除') return '¥' + data.reduce((s, r) => s + r.deduction, 0);
  if (c.label === '应发') return '¥' + data.reduce((s, r) => s + r.payable, 0);
  return '';
});

onMounted(load);
</script>
