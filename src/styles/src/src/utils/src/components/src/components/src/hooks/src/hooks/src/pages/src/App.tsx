import React from "react";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Header />
      <Home />
    </div>
  );
}
