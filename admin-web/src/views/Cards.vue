<template>
  <div>
    <h2 class="page-title">会员卡（手动充值/发券 · 系统自动扣款 · 流水可查）</h2>

    <el-card shadow="never">
      <template #header>
        <div style="display:flex;align-items:center;gap:10px">
          <span>会员卡列表</span>
          <el-input v-model="kw" placeholder="搜索openid" clearable style="width:240px" @keyup.enter="load" />
          <el-button type="danger" size="small" @click="load">查询</el-button>
        </div>
      </template>
      <el-table :data="cards" size="small">
        <el-table-column prop="openid" label="openid" min-width="200" />
        <el-table-column label="余额" width="110"><template #default="{ row }"><span class="gold">¥{{ row.balance }}</span></template></el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag :type="row.status==='active'?'success':'info'">{{ row.status==='active'?'正常':'冻结' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="created_at" label="开卡时间" width="170" />
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain @click="openRecharge(row)">充值</el-button>
            <el-button size="small" @click="openCoupon(row)">发券</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" style="margin-top:14px">
      <template #header>卡券流水（consume/refund 由系统自动记账）</template>
      <el-table :data="flows" size="small">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="openid" label="openid" min-width="180" show-overflow-tooltip />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="{ recharge:'success', issue:'warning', consume:'danger', refund:'' }[row.type]" size="small">
              {{ { recharge:'充值', issue:'发券', consume:'消费', refund:'退款' }[row.type] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="amount" label="金额" width="90"><template #default="{ row }">¥{{ row.amount }}</template></el-table-column>
        <el-table-column prop="remark" label="备注" min-width="180" />
        <el-table-column prop="operator" label="操作方" width="110" />
        <el-table-column prop="created_at" label="时间" width="170" />
      </el-table>
    </el-card>

    <el-dialog v-model="reDlg" title="会员卡充值" width="420px">
      <el-form label-width="80px">
        <el-form-item label="openid"><el-input v-model="re.openid" disabled /></el-form-item>
        <el-form-item label="金额"><el-input-number v-model="re.amount" :min="1" :step="100" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="re.remark" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="reDlg=false">取消</el-button><el-button type="danger" @click="submitRe">充值</el-button></template>
    </el-dialog>

    <el-dialog v-model="cpDlg" title="发放优惠券" width="420px">
      <el-form label-width="80px">
        <el-form-item label="openid"><el-input v-model="cp.openid" disabled /></el-form-item>
        <el-form-item label="券名"><el-input v-model="cp.name" /></el-form-item>
        <el-form-item label="面额"><el-input-number v-model="cp.value" :min="1" :step="10" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="cpDlg=false">取消</el-button><el-button type="danger" @click="submitCp">发放</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const kw = ref(''); const cards = ref([]); const flows = ref([]);
const reDlg = ref(false); const cpDlg = ref(false);
const re = reactive({ openid: '', amount: 500, remark: '' });
const cp = reactive({ openid: '', name: '满减券', value: 50 });

const load = () => {
  api.get('/admin/cards', { params: { keyword: kw.value } }).then(r => cards.value = r.data);
  api.get('/admin/flows', { params: { keyword: kw.value } }).then(r => flows.value = r.data);
};

const openRecharge = row => { re.openid = row.openid; re.amount = 500; re.remark = ''; reDlg.value = true; };
const submitRe = () => api.post('/admin/cards/recharge', re).then(() => { ElMessage.success('已充值'); reDlg.value = false; load(); });
const openCoupon = row => { cp.openid = row.openid; cp.name = '满减券'; cp.value = 50; cpDlg.value = true; };
const submitCp = () => api.post('/admin/cards/coupon', cp).then(() => { ElMessage.success('已发券'); cpDlg.value = false; load(); });

onMounted(load);
</script>
