import type { RouteConfig } from '@react-router/dev/routes';
import { flatRoutes } from '@react-router/fs-routes';

// File-based routing. Each route is a folder under app/routes/ whose route.tsx is the
// route module; everything else in that folder (components, hooks, API calls) belongs
// to that route alone. Code shared by several routes lives in app/features/<name>/.
export default flatRoutes() satisfies RouteConfig;
