/** Minimum distance from the Z axis to a triangle, including its interior.
 * Project onto XY: the axis intersects the projection iff its radius is zero.
 */
export function minimumTriangleRadius(a: number[], b: number[], c: number[]): number {
 const cross=(p:number[],q:number[])=>p[0]*q[1]-p[1]*q[0];
 const signs=[cross(a,b),cross(b,c),cross(c,a)];
 const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 if(Math.abs(area)>1e-12&&(signs.every(v=>v>=0)||signs.every(v=>v<=0)))return 0;
 const edge=(p:number[],q:number[])=>{
  const dx=q[0]-p[0],dy=q[1]-p[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,-(p[0]*dx+p[1]*dy)/length)):0;
  return Math.hypot(p[0]+t*dx,p[1]+t*dy);
 };
 return Math.min(edge(a,b),edge(b,c),edge(c,a));
}
