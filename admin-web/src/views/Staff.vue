<template>
  <div>
    <h2 class="page-title">员工账号与DM档案（底薪保密，仅管理员可见）</h2>

    <el-card shadow="never">
      <template #header>
        <div style="display:flex;align-items:center">
          <span>账号（员工编号1~30）</span>
          <el-button type="primary" size="small" style="margin-left:auto" @click="openAcc()">开通账号</el-button>
        </div>
      </template>
      <el-table :data="accounts" size="small">
        <el-table-column prop="staff_no" label="编号" width="70" />
        <el-table-column prop="name" label="姓名" width="100" />
        <el-table-column prop="phone" label="电话" width="130" />
        <el-table-column label="角色" width="90">
          <template #default="{ row }"><el-tag :type="row.role==='admin'?'danger':''">{{ row.role==='admin'?'超管':'员工' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="stage_name" label="DM花名" width="100" />
        <el-table-column label="底薪" width="90"><template #default="{ row }"><span class="gold">¥{{ row.base_salary || '-' }}</span></template></el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status==='active'?'success':'info'">{{ row.status==='active'?'正常':'停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <template v-if="row.role !== 'admin'">
              <el-button v-if="row.status==='active'" size="small" type="warning" plain @click="toggleAcc(row,'disabled')">停用</el-button>
              <el-button v-else size="small" type="success" plain @click="toggleAcc(row,'active')">启用</el-button>
              <el-button size="small" @click="resetPwd(row)">重置密码</el-button>
              <el-button v-if="row.dm_id" size="small" @click="openSkill(row)">技能</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-top:14px">
      <template #header>
        <div style="display:flex;align-items:center">
          <span>DM档案</span>
          <el-button type="primary" size="small" style="margin-left:auto" @click="openDm()">新建DM</el-button>
        </div>
      </template>
      <el-table :data="dms" size="small">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="stage_name" label="花名" width="100" />
        <el-table-column prop="tags" label="标签" min-width="140" />
        <el-table-column prop="intro" label="简介" min-width="180" show-overflow-tooltip />
        <el-table-column label="底薪(保密)" width="110"><template #default="{ row }">¥{{ row.base_salary }}</template></el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }"><el-tag :type="row.status==='active'?'success':'info'">{{ row.status==='active'?'在职':'离岗' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="160">
          <template #default="{ row }">
            <el-button size="small" @click="openDm(row)">编辑</el-button>
            <el-button size="small" @click="openSkill({ dm_id: row.id, stage_name: row.stage_name })">技能</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 开通账号 -->
    <el-dialog v-model="accDlg" title="开通员工账号" width="460px">
      <el-form label-width="90px">
        <el-form-item label="编号(1~30)"><el-input-number v-model="acc.staff_no" :min="1" :max="30" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="acc.name" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="acc.phone" /></el-form-item>
        <el-form-item label="初始密码"><el-input v-model="acc.password" /></el-form-item>
        <el-form-item label="同时建DM">
          <el-switch v-model="acc.create_dm" />
          <template v-if="acc.create_dm">
            <el-input v-model="acc.stage_name" placeholder="花名（默认姓名）" style="width:160px;margin-left:10px" />
            <el-input-number v-model="acc.base_salary" :min="0" :step="500" placeholder="底薪" style="margin-left:10px" />
          </template>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="accDlg=false">取消</el-button><el-button type="danger" @click="submitAcc">开通</el-button></template>
    </el-dialog>

    <!-- DM档案编辑 -->
    <el-dialog v-model="dmDlg" :title="dm.id ? '编辑DM档案' : '新建DM档案'" width="480px">
      <el-form label-width="90px">
        <el-form-item label="花名"><el-input v-model="dm.stage_name" /></el-form-item>
        <el-form-item label="形象照URL"><el-input v-model="dm.photo" placeholder="https://..." /></el-form-item>
        <el-form-item label="标签"><el-input v-model="dm.tags" placeholder="逗号分隔，如：金牌DM,推理控" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="dm.intro" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="保密底薪"><el-input-number v-model="dm.base_salary" :min="0" :step="500" /></el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="dm.status"><el-radio value="active">在职</el-radio><el-radio value="inactive">离岗</el-radio></el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="dmDlg=false">取消</el-button><el-button type="danger" @click="submitDm">保存</el-button></template>
    </el-dialog>

    <!-- 技能矩阵 -->
    <el-dialog v-model="skillDlg" :title="`技能矩阵：${skillDmName}（会哪些本/角色及熟练度）`" width="720px">
      <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <el-select v-model="skill.script_id" filterable remote :remote-method="searchScript" placeholder="搜索剧本" style="width:280px">
          <el-option v-for="s in scriptOpts" :key="s.id" :value="s.id" :label="s.name" />
        </el-select>
        <el-input v-model="skill.role_name" placeholder="角色（可选）" style="width:140px" />
        <el-input-number v-model="skill.proficiency" :min="1" :max="5" placeholder="熟练度" />
        <el-button type="danger" @click="submitSkill">添加/更新</el-button>
      </div>
      <el-table :data="skills" size="small" max-height="360">
        <el-table-column prop="script_name" label="剧本" min-width="180" />
        <el-table-column prop="role_name" label="角色" width="110" />
        <el-table-column label="熟练度" width="160">
          <template #default="{ row }"><el-rate :model-value="row.proficiency" disabled /></template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }"><el-button size="small" type="danger" plain @click="delSkill(row)">删</el-button></template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import api from '../api';

const accounts = ref([]); const dms = ref([]);
const accDlg = ref(false); const dmDlg = ref(false); const skillDlg = ref(false);
const acc = reactive({ staff_no: 1, name: '', phone: '', password: '123456', create_dm: true, stage_name: '', base_salary: 3500 });
const dm = reactive({ id: null, stage_name: '', photo: '', tags: '', intro: '', base_salary: 3500, status: 'active' });
const skills = ref([]); const skillDmId = ref(null); const skillDmName = ref('');
const skill = reactive({ script_id: null, role_name: '', proficiency: 3 });
const scriptOpts = ref([]);

const load = () => {
  api.get('/admin/accounts').then(r => accounts.value = r.data);
  api.get('/admin/dms').then(r => dms.value = r.data);
};

const openAcc = () => { Object.assign(acc, { staff_no: 1, name: '', phone: '', password: '123456', create_dm: true, stage_name: '', base_salary: 3500 }); accDlg.value = true; };
const submitAcc = () => {
  if (!acc.name || !acc.password) return ElMessage.warning('姓名与密码必填');
  api.post('/admin/accounts', acc).then(() => { ElMessage.success('已开通'); accDlg.value = false; load(); });
};
const toggleAcc = (row, status) => api.put(`/admin/accounts/${row.id}`, { status }).then(() => load());
const resetPwd = row => ElMessageBox.prompt('输入新密码', `重置 ${row.name} 的密码`).then(({ value }) =>
  api.put(`/admin/accounts/${row.id}`, { password: value }).then(() => ElMessage.success('已重置')));

const openDm = row => { Object.assign(dm, row || { id: null, stage_name: '', photo: '', tags: '', intro: '', base_salary: 3500, status: 'active' }); dmDlg.value = true; };
const submitDm = () => {
  if (!dm.stage_name) return ElMessage.warning('花名必填');
  const p = dm.id ? api.put(`/admin/dms/${dm.id}`, dm) : api.post('/admin/dms', dm);
  p.then(() => { ElMessage.success('已保存'); dmDlg.value = false; load(); });
};

const searchScript = kw => api.get('/admin/scripts', { params: { keyword: kw, size: 50 } }).then(r => scriptOpts.value = r.data.list);
const openSkill = row => {
  skillDmId.value = row.dm_id || row.id; skillDmName.value = row.stage_name;
  skillDlg.value = true; skill.script_id = null; skill.role_name = ''; skill.proficiency = 3;
  api.get('/admin/skills', { params: { dm_id: skillDmId.value } }).then(r => skills.value = r.data);
};
const submitSkill = () => {
  if (!skill.script_id) return ElMessage.warning('请选择剧本');
  api.post('/admin/skills', { dm_id: skillDmId.value, ...skill }).then(() => { ElMessage.success('已保存'); openSkill({ dm_id: skillDmId.value, stage_name: skillDmName.value }); });
};
const delSkill = row => api.delete(`/admin/skills/${row.id}`).then(() => openSkill({ dm_id: skillDmId.value, stage_name: skillDmName.value }));

onMounted(load);
</script>
