import { createClient } from '../lib/supabase';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) redirect('/login');

  const [{ data: categories }, { data: goals }] = await Promise.all([
    supabase.from('budget_categories').select('*').order('name'),
    supabase.from('savings_goals').select('*').order('created_at'),
  ]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8">
      <h1 className="text-3xl font-light text-slate-100 mb-8">Budget Overview</h1>

      <section className="mb-10">
        <p className="text-xs text-slate-500 tracking-widest mb-4">BUDGET CATEGORIES</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories?.map(cat => (
            <div key={cat.id} className="bg-slate-900 rounded-xl p-4 border border-slate-800">
              <p className="text-slate-300">{cat.emoji} {cat.name}</p>
              <p className="text-slate-500 text-sm mt-1">
                Limit: ${Number(cat.monthly_limit).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <p className="text-xs text-slate-500 tracking-widest mb-4">SAVINGS GOALS</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {goals?.map(goal => {
            const pct = Math.round((goal.current_amount / goal.target_amount) * 100);
            return (
              <div key={goal.id} className="bg-slate-900 rounded-xl p-4 border border-slate-800">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-slate-300">{goal.emoji} {goal.name}</p>
                  <span className="text-indigo-400 text-sm">{pct}%</span>
                </div>
                <div className="bg-slate-800 rounded-full h-1.5">
                  <div
                    className="bg-indigo-500 h-full rounded-full"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <p className="text-slate-600 text-xs mt-2">
                  ${Number(goal.current_amount).toLocaleString()} of ${Number(goal.target_amount).toLocaleString()}
                </p>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
