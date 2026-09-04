<template>
  <div>
    <h2 class="page-title">场次排班（核心：冲突强校验 · 72h自动补位 · 换人重算薪资）</h2>

    <el-card shadow="never">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <el-date-picker v-model="q.date" type="date" value-format="YYYY-MM-DD" placeholder="按日期筛选" style="width:150px" />
        <el-select v-model="q.slot" placeholder="全部时段" clearable style="width:120px">
          <el-option label="午场" value="noon" /><el-option label="晚场" value="night" />
        </el-select>
        <el-button type="danger" @click="load">查询</el-button>
        <el-button @click="fillNow" :loading="filling">执行自动补位</el-button>
        <div style="flex:1"></div>
        <el-button type="warning" plain @click="leaveDlg = true">请假登记</el-button>
        <el-button type="primary" @click="openCreate">新建场次</el-button>
      </div>
    </el-card>

    <el-card shadow="never" style="margin-top:14px">
      <el-table :data="list" size="small">
        <el-table-column prop="work_date" label="日期" width="110" />
        <el-table-column label="时段" width="70">
          <template #default="{ row }">{{ row.slot === 'noon' ? '午场' : '晚场' }}</template>
        </el-table-column>
        <el-table-column prop="start_time" label="开场" width="70" />
        <el-table-column prop="script_name" label="剧本" min-width="160">
          <template #default="{ row }">{{ row.script_name }} <el-tag v-if="row.grade==='18+'" type="danger" size="small">{{ row.grade }}</el-tag></template>
        </el-table-column>
        <el-table-column label="已排DM" min-width="240">
          <template #default="{ row }">
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <el-tag v-for="d in row.dms" :key="d.id" size="small"
                :type="d.source === 'auto' ? 'warning' : d.source === 'locked' ? 'danger' : 'info'"
                :title="'来源：' + ({locked:'玩家锁卡',auto:'自动补位',manual:'手动'}[d.source])">
                {{ d.stage_name }}
              </el-tag>
              <el-tag v-if="row.dms.length < row.required_dm" size="small" type="warning">缺 {{ row.required_dm - row.dms.length }} 人</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.status==='cancelled'" type="info">已取消</el-tag>
            <el-tag v-else-if="row.warn" type="warning">缺人预警</el-tag>
            <el-tag v-else-if="row.status==='full'" type="success">已满</el-tag>
            <el-tag v-else>待补位</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status !== 'cancelled'">
              <el-button size="small" type="danger" plain @click="openAssign(row)">加DM</el-button>
              <el-button size="small" @click="openSwap(row)">换人</el-button>
              <el-dropdown trigger="click" @command="cmd => rowCmd(cmd, row)">
                <el-button size="small">更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="remove">移除DM</el-dropdown-item>
                    <el-dropdown-item command="cancel">取消场次</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-top:14px" v-if="leaves.length">
      <template #header>近期请假登记</template>
      <el-table :data="leaves" size="small">
        <el-table-column prop="work_date" label="日期" width="110" />
        <el-table-column prop="stage_name" label="DM" width="100" />
        <el-table-column label="时段" width="80"><template #default="{ row }">{{ { noon:'午场', night:'晚场', all:'全天' }[row.slot] }}</template></el-table-column>
        <el-table-column prop="reason" label="事由" />
        <el-table-column label="操作" width="100">
          <template #default="{ row }"><el-button size="small" @click="revokeLeave(row)">撤销</el-button></template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新建场次 -->
    <el-dialog v-model="createDlg" title="新建场次（日期+时段+剧本）" width="440px">
      <el-form label-width="80px">
        <el-form-item label="日期"><el-date-picker v-model="create.date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="时段">
          <el-radio-group v-model="create.slot">
            <el-radio value="noon">午场</el-radio><el-radio value="night">晚场</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="剧本">
          <el-select v-model="create.script_id" filterable remote :remote-method="searchScript" :loading="scriptLoading" placeholder="搜索剧本名称" style="width:100%">
            <el-option v-for="s in scriptOpts" :key="s.id" :value="s.id" :label="`${s.name}（${s.grade}·¥${s.price}）`" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="createDlg=false">取消</el-button><el-button type="danger" @click="submitCreate">建场</el-button></template>
    </el-dialog>

    <!-- 加DM -->
    <el-dialog v-model="assignDlg" title="手动排DM（占用置灰，冲突后端强校验）" width="640px">
      <div v-if="cur" style="margin-bottom:10px" class="gold">{{ cur.work_date }} {{ cur.slot==='noon'?'午场':'晚场' }} · {{ cur.script_name }} · 需{{ cur.required_dm }}人</div>
      <el-table :data="freeDms" size="small" max-height="320"
        @selection-change="rows => assignSel = rows" ref="assignTable">
        <el-table-column type="selection" width="40" :selectable="r => r.av === 'free'" />
        <el-table-column prop="stage_name" label="DM" width="110" />
        <el-table-column label="时段状态" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.av==='free'" type="success">空闲</el-tag>
            <el-tag v-else-if="row.av==='busy'" type="info">已占用（其他场）</el-tag>
            <el-tag v-else type="info">已请假</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="技能匹配" width="100">
          <template #default="{ row }"><el-tag v-if="row.has_skill" type="warning">会此本</el-tag><span v-else class="warn">不会</span></template>
        </el-table-column>
      </el-table>
      <el-input v-model="assignRole" placeholder="指派角色（可选）" style="margin-top:10px" />
      <template #footer><el-button @click="assignDlg=false">取消</el-button><el-button type="danger" @click="submitAssign">排入本場</el-button></template>
    </el-dialog>

    <!-- 换人 -->
    <el-dialog v-model="swapDlg" title="换人（先校验→换占用→自动重算两人薪资）" width="480px">
      <el-form label-width="90px" v-if="cur">
        <el-form-item label="原DM">
          <el-select v-model="swap.from_dm" style="width:100%">
            <el-option v-for="d in cur.dms" :key="d.dm_id" :value="d.dm_id" :label="d.stage_name" />
          </el-select>
        </el-form-item>
        <el-form-item label="新DM">
          <el-select v-model="swap.to_dm" style="width:100%">
            <el-option v-for="d in freeDms" :key="d.id" :value="d.id" :label="d.stage_name + (d.av==='free' ? '（空闲）' : '（' + ({busy:'已占用',leave:'请假'}[d.av]) + '不可选）')" :disabled="d.av!=='free'" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="swapDlg=false">取消</el-button><el-button type="danger" @click="submitSwap">确认换人</el-button></template>
    </el-dialog>

    <!-- 移除DM -->
    <el-dialog v-model="removeDlg" title="移除DM" width="420px">
      <el-select v-model="removeDmId" placeholder="选择要移除的DM" style="width:100%">
        <el-option v-for="d in (cur ? cur.dms : [])" :key="d.dm_id" :value="d.dm_id" :label="d.stage_name" />
      </el-select>
      <template #footer><el-button @click="removeDlg=false">取消</el-button><el-button type="danger" @click="submitRemove">移除并释放时段</el-button></template>
    </el-dialog>

    <!-- 请假登记 -->
    <el-dialog v-model="leaveDlg" title="请假登记（已排班时段需先换人）" width="440px">
      <el-form label-width="80px">
        <el-form-item label="DM">
          <el-select v-model="leave.dm_id" style="width:100%">
            <el-option v-for="d in dms" :key="d.id" :value="d.id" :label="d.stage_name" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期"><el-date-picker v-model="leave.date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item label="时段">
          <el-radio-group v-model="leave.slot">
            <el-radio value="all">全天</el-radio><el-radio value="noon">午场</el-radio><el-radio value="night">晚场</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="事由"><el-input v-model="leave.reason" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="leaveDlg=false">取消</el-button><el-button type="danger" @click="submitLeave">登记</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import api from '../api';

const q = reactive({ date: dayjs().format('YYYY-MM-DD'), slot: '' });
const list = ref([]); const leaves = ref([]); const dms = ref([]);
const filling = ref(false);
const cur = ref(null);
const createDlg = ref(false); const assignDlg = ref(false); const swapDlg = ref(false);
const removeDlg = ref(false); const leaveDlg = ref(false);
const create = reactive({ date: dayjs().format('YYYY-MM-DD'), slot: 'noon', script_id: null });
const scriptOpts = ref([]); const scriptLoading = ref(false);
const freeDms = ref([]); const assignSel = ref([]); const assignRole = ref('');
const swap = reactive({ from_dm: null, to_dm: null });
const removeDmId = ref(null);
const leave = reactive({ dm_id: null, date: dayjs().format('YYYY-MM-DD'), slot: 'all', reason: '' });

const load = () => {
  api.get('/admin/sessions', { params: q }).then(r => list.value = r.data);
  api.get('/admin/leaves').then(r => leaves.value = r.data);
  api.get('/admin/dms').then(r => dms.value = (r.data || []).filter(d => d.status === 'active'));
};

const searchScript = kw => {
  scriptLoading.value = true;
  api.get('/admin/scripts', { params: { keyword: kw, size: 50, status: 'on' } })
    .then(r => scriptOpts.value = r.data.list)
    .finally(() => scriptLoading.value = false);
};

const openCreate = () => { create.script_id = null; createDlg.value = true; searchScript(''); };
const submitCreate = () => {
  if (!create.date || !create.script_id) return ElMessage.warning('请选择日期和剧本');
  api.post('/admin/sessions', create).then(() => { ElMessage.success('已建场'); createDlg.value = false; load(); });
};

// 加DM：拉取候选（占用置灰不可选）
const loadFree = () => api.get('/admin/dms/free', {
  params: { date: cur.value.work_date, slot: cur.value.slot, script_id: cur.value.script_id, exclude_session: cur.value.id }
}).then(r => freeDms.value = r.data);

const openAssign = row => { cur.value = row; assignSel.value = []; assignRole.value = ''; assignDlg.value = true; loadFree(); };
const submitAssign = () => {
  if (!assignSel.value.length) return ElMessage.warning('请勾选空闲DM（置灰不可选）');
  Promise.all(assignSel.value.map(d =>
    api.post(`/admin/sessions/${cur.value.id}/assign`, { dm_id: d.id, role_name: assignRole.value })
  )).then(() => { ElMessage.success('已排入'); assignDlg.value = false; load(); });
};

const openSwap = row => { cur.value = row; swap.from_dm = null; swap.to_dm = null; swapDlg.value = true; loadFree(); };
const submitSwap = () => {
  if (!swap.from_dm || !swap.to_dm) return ElMessage.warning('请选择原DM与新DM');
  api.post(`/admin/sessions/${cur.value.id}/swap`, swap).then(() => { ElMessage.success('已换人并重算薪资'); swapDlg.value = false; load(); });
};

const rowCmd = (cmd, row) => {
  cur.value = row;
  if (cmd === 'cancel') {
    ElMessageBox.confirm('取消整场将释放全部DM占用并自动退款相关预约，确认？', '取消场次', { type: 'warning' })
      .then(() => api.post(`/admin/sessions/${row.id}/cancel`).then(() => { ElMessage.success('已取消'); load(); }))
      .catch(() => {});
  } else {
    removeDmId.value = null; removeDlg.value = true;
  }
};
const submitRemove = () => {
  if (!removeDmId.value) return ElMessage.warning('请选择DM');
  api.post(`/admin/sessions/${cur.value.id}/remove`, { dm_id: removeDmId.value })
    .then(() => { ElMessage.success('已移除并释放时段'); removeDlg.value = false; load(); });
};

const submitLeave = () => {
  if (!leave.dm_id || !leave.date) return ElMessage.warning('请选择DM和日期');
  api.post('/admin/leaves', leave).then(() => { ElMessage.success('已登记'); leaveDlg.value = false; load(); });
};
const revokeLeave = row => api.delete(`/admin/leaves/${row.id}`).then(() => { ElMessage.success('已撤销'); load(); });

const fillNow = () => {
  filling.value = true;
  api.post('/admin/autofill').then(r => {
    ElMessage.success(`补位 ${r.data.filled} 席，缺人 ${r.data.warnings.length} 场`);
    load();
  }).finally(() => filling.value = false);
};

onMounted(load);
</script>
