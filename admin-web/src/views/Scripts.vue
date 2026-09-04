<template>
  <div>
    <h2 class="page-title">剧本管理（全量468本 · 改价/分级/角色提成/上下架）</h2>
    <el-card shadow="never">
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <el-input v-model="q.keyword" placeholder="剧本名称" clearable style="width:200px" @keyup.enter="load" />
        <el-select v-model="q.grade" placeholder="分级" clearable style="width:110px">
          <el-option label="12+" value="12+" /><el-option label="18+" value="18+" />
        </el-select>
        <el-select v-model="q.status" placeholder="状态" clearable style="width:110px">
          <el-option label="上架" value="on" /><el-option label="下架" value="off" />
        </el-select>
        <el-button type="danger" @click="load">查询</el-button>
        <div style="flex:1"></div>
        <el-button type="primary" @click="openEdit()">新建剧本</el-button>
      </div>
      <el-table :data="list" size="small">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column prop="type" label="类型" width="80" />
        <el-table-column label="人数" width="80"><template #default="{ row }">{{ row.players_min }}-{{ row.players_max }}</template></el-table-column>
        <el-table-column prop="duration_min" label="时长" width="70" />
        <el-table-column prop="price" label="价格" width="90"><template #default="{ row }"><span class="gold">¥{{ row.price }}</span></template></el-table-column>
        <el-table-column label="分级" width="70">
          <template #default="{ row }"><el-tag :type="row.grade==='18+'?'danger':'info'" size="small">{{ row.grade }}</el-tag></template>
        </el-table-column>
        <el-table-column label="角色数" width="70"><template #default="{ row }">{{ (row.roles || []).length }}</template></el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }"><el-tag :type="row.status==='on'?'success':'info'">{{ row.status==='on'?'上架':'下架' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" :type="row.status==='on'?'warning':'success'" plain @click="toggle(row)">
              {{ row.status==='on' ? '下架' : '上架' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination style="margin-top:12px" background layout="total, prev, pager, next"
        :total="total" :page-size="q.size" :current-page="q.page"
        @current-change="p => { q.page = p; load(); }" />
    </el-card>

    <el-dialog v-model="dlg" :title="form.id ? '编辑剧本' : '新建剧本'" width="620px">
      <el-form label-width="90px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-row>
          <el-col :span="12"><el-form-item label="类型"><el-input v-model="form.type" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="分级">
            <el-radio-group v-model="form.grade"><el-radio value="12+">12+</el-radio><el-radio value="18+">18+</el-radio></el-radio-group>
          </el-form-item></el-col>
        </el-row>
        <el-row>
          <el-col :span="8"><el-form-item label="最少人数"><el-input-number v-model="form.players_min" :min="2" :max="12" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="最多人数"><el-input-number v-model="form.players_max" :min="2" :max="20" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="时长(分)"><el-input-number v-model="form.duration_min" :min="60" :step="30" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="价格"><el-input-number v-model="form.price" :min="0" :step="10" /></el-form-item>
        <el-form-item label="简介"><el-input v-model="form.intro" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="角色与提成">
          <div style="width:100%">
            <div v-for="(r, i) in form.roles" :key="i" style="display:flex;gap:8px;margin-bottom:6px">
              <el-input v-model="r.name" placeholder="角色名" style="width:180px" />
              <el-input-number v-model="r.commission" :min="0" :step="10" placeholder="单场提成" />
              <el-button type="danger" plain size="small" @click="form.roles.splice(i,1)">删</el-button>
            </div>
            <el-button size="small" @click="form.roles.push({ name: '', commission: 30 })">+ 添加角色</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="dlg=false">取消</el-button><el-button type="danger" @click="save">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import api from '../api';

const q = reactive({ keyword: '', grade: '', status: '', page: 1, size: 20 });
const list = ref([]); const total = ref(0); const dlg = ref(false);
const form = reactive({});

const load = () => api.get('/admin/scripts', { params: q }).then(r => { list.value = r.data.list; total.value = r.data.total; });

const openEdit = row => {
  Object.assign(form, row || { name: '', type: '推理', players_min: 4, players_max: 8, duration_min: 240, price: 168, grade: '12+', intro: '', roles: [], status: 'on' });
  form.roles = [...(form.roles || [])];
  dlg.value = true;
};
const save = () => {
  if (!form.name) return ElMessage.warning('名称必填');
  const p = form.id ? api.put(`/admin/scripts/${form.id}`, form) : api.post('/admin/scripts', form);
  p.then(() => { ElMessage.success('已保存'); dlg.value = false; load(); });
};
const toggle = row => api.put(`/admin/scripts/${row.id}`, { ...row, status: row.status === 'on' ? 'off' : 'on' })
  .then(() => { ElMessage.success('已更新'); load(); });

onMounted(load);
</script>
