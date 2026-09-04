<template>
  <div>
    <h2 class="page-title">小程序用户（客户登录账号，可升级为DM）</h2>

    <el-card shadow="never">
      <template #header>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px">
          <span>用户列表</span>
          <el-input v-model="query.keyword" placeholder="搜索昵称/电话/openid" style="width:240px" clearable @keyup.enter="load" @clear="load" />
          <el-select v-model="query.role" style="width:130px" @change="load">
            <el-option label="全部角色" value="" />
            <el-option label="玩家" value="player" />
            <el-option label="DM" value="dm" />
          </el-select>
          <el-button type="primary" size="small" style="margin-left:auto" @click="load">刷新</el-button>
        </div>
      </template>
      <el-table :data="users" size="small">
        <el-table-column label="头像" width="64">
          <template #default="{ row }">
            <el-avatar :size="36" :src="avatarUrl(row.avatar)">{{ (row.nickname || '玩')[0] }}</el-avatar>
          </template>
        </el-table-column>
        <el-table-column prop="nickname" label="昵称" width="120" />
        <el-table-column prop="phone" label="电话" width="130" />
        <el-table-column prop="openid" label="openid" min-width="170" show-overflow-tooltip />
        <el-table-column label="角色" width="80">
          <template #default="{ row }">
            <el-tag :type="row.role === 'dm' ? 'warning' : ''">{{ row.role === 'dm' ? 'DM' : '玩家' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="stage_name" label="DM花名" width="100" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'danger'">{{ row.status === 'active' ? '正常' : '封禁' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="注册时间" width="160" />
        <el-table-column label="操作" min-width="300">
          <template #default="{ row }">
            <el-button v-if="row.role !== 'dm'" size="small" type="warning" plain @click="openSetDm(row)">设为DM</el-button>
            <el-button v-else size="small" type="info" plain @click="unsetDm(row)">撤销DM</el-button>
            <el-button size="small" @click="editPhone(row)">改电话</el-button>
            <el-button v-if="row.status === 'active'" size="small" type="danger" plain @click="toggle(row, 'banned')">封禁</el-button>
            <el-button v-else size="small" type="success" plain @click="toggle(row, 'active')">解封</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div style="margin-top:12px;display:flex;justify-content:flex-end">
        <el-pagination layout="total, prev, pager, next" :total="total" :page-size="query.size"
          :current-page="query.page" @current-change="p => { query.page = p; load(); }" />
      </div>
    </el-card>

    <!-- 设为DM：创建/激活DM档案 -->
    <el-dialog v-model="dmDlg" title="设为DM（授权小程序工作台）" width="460px">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:14px"
        title="设为DM后，该用户小程序「我的」页将出现DM工作台（排班/薪资/提成表），并进入玩家端DM列表。" />
      <el-form label-width="90px">
        <el-form-item label="用户">{{ dmForm.nickname }}（{{ dmForm.openid }}）</el-form-item>
        <el-form-item label="花名"><el-input v-model="dmForm.stage_name" placeholder="默认用昵称" /></el-form-item>
        <el-form-item label="标签"><el-input v-model="dmForm.tags" placeholder="逗号分隔，如：金牌DM,推理控" /></el-form-item>
        <el-form-item label="保密底薪"><el-input-number v-model="dmForm.base_salary" :min="0" :step="500" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dmDlg = false">取消</el-button>
        <el-button type="danger" @click="submitSetDm">确认设为DM</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const users = ref([]); const total = ref(0);
const query = reactive({ keyword: '', role: '', page: 1, size: 20 });
const dmDlg = ref(false);
const dmForm = reactive({ id: null, nickname: '', openid: '', stage_name: '', tags: '', base_salary: 3500 });

// 相对路径 /uploads/... 由vite代理转发；空值返回undefined以触发el-avatar文字兜底
const avatarUrl = a => a || undefined;

const load = () => {
  api.get('/admin/users', { params: query }).then(r => {
    users.value = r.data.list; total.value = r.data.total;
  });
};

const openSetDm = row => {
  Object.assign(dmForm, {
    id: row.id, nickname: row.nickname, openid: row.openid,
    stage_name: row.stage_name || row.nickname || '', tags: '', base_salary: 3500
  });
  dmDlg.value = true;
};
const submitSetDm = () => {
  api.post(`/admin/users/${dmForm.id}/set-dm`, {
    stage_name: dmForm.stage_name, tags: dmForm.tags, base_salary: dmForm.base_salary
  }).then(r => { ElMessage.success(r.msg); dmDlg.value = false; load(); });
};

const unsetDm = row => ElMessageBox.confirm(
  `撤销「${row.nickname}」的DM身份？其DM档案将离岗（保留历史排班与薪资），账户回到普通玩家。`, '撤销DM'
).then(() => api.post(`/admin/users/${row.id}/unset-dm`).then(r => { ElMessage.success(r.msg); load(); }));

const editPhone = row => ElMessageBox.prompt('输入新电话', `修改 ${row.nickname} 的电话`, { inputValue: row.phone || '' })
  .then(({ value }) => api.put(`/admin/users/${row.id}`, { phone: value }).then(() => { ElMessage.success('已保存'); load(); }));

const toggle = (row, status) => api.put(`/admin/users/${row.id}`, { status }).then(() => load());

onMounted(load);
</script>
