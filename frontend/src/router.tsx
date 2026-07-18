import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/components/nav/AppShell";
import { Home } from "@/pages/Home";
import { Layout } from "@/pages/Layout";
import { PlantsDatabase } from "@/pages/PlantsDatabase";
import { PlantDetail } from "@/pages/PlantDetail";

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/layout", element: <Layout /> },
      { path: "/plants", element: <PlantsDatabase /> },
      { path: "/plants/:slug", element: <PlantDetail /> },
    ],
  },
]);
